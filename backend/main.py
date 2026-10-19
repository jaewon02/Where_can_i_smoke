import json
import math
import os
import uuid
from datetime import date
from pathlib import Path
from typing import Literal

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from db import get_conn, init_db

load_dotenv(Path(__file__).parent / ".env")

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
MAX_PHOTOS = 4
MAX_PHOTO_BYTES = 5 * 1024 * 1024

app = FastAPI(title="흡연구역 지도 API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.mount("/api/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


@app.on_event("startup")
def startup() -> None:
    init_db()


def sniff_image_ext(data: bytes) -> str | None:
    """확장자/Content-Type은 믿지 않고 파일 앞부분(매직 바이트)으로 이미지 종류를 판별"""
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return None


@app.get("/api/zones")
def list_zones(
    south: float = Query(..., description="지도 남쪽 위도"),
    west: float = Query(..., description="지도 서쪽 경도"),
    north: float = Query(..., description="지도 북쪽 위도"),
    east: float = Query(..., description="지도 동쪽 경도"),
    type: Literal["smoking", "nonsmoking"] | None = None,
    limit: int = Query(500, le=2000),
):
    # 목록에 보여줄 후기 수 / 평균 별점도 함께
    sql = (
        "SELECT z.*, COUNT(r.id) AS review_count, ROUND(AVG(r.rating), 1) AS avg_rating"
        " FROM zones z LEFT JOIN reviews r ON r.zone_id = z.id"
        " WHERE z.lat BETWEEN ? AND ? AND z.lng BETWEEN ? AND ?"
    )
    params: list = [south, north, west, east]
    if type:
        sql += " AND z.type = ?"
        params.append(type)
    sql += " GROUP BY z.id LIMIT ?"
    params.append(limit)
    with get_conn() as conn:
        return [dict(r) for r in conn.execute(sql, params)]


@app.get("/api/facilities")
def list_facilities(
    south: float = Query(...),
    west: float = Query(...),
    north: float = Query(...),
    east: float = Query(...),
    limit: int = Query(5000, le=20000),
):
    """지도 영역 안의 금연 규칙 대상 시설 (축소/확대와 상관없이 DB에 저장된 전체에서 조회)

    area: 시설 경계선 기준으로 계산한 금연 구역(MultiPolygon). 경계선을 모르면 null 이고 r(m) 반경 원으로 그림.
    지하철역 점('subway')은 출입구('subway-exit')로 대체했으므로 내려주지 않음.
    """
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, type_key, name, lat, lng, area, r FROM facilities "
            "WHERE type_key != 'subway' AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? LIMIT ?",
            (south, north, west, east, limit),
        )
        out = []
        for r in rows:
            d = dict(r)
            d["area"] = json.loads(d["area"]) if d["area"] else None
            out.append(d)
        return out


class FacilityIn(BaseModel):
    kakao_id: str = Field(max_length=40)
    type_key: str = Field(max_length=40)
    name: str = Field(max_length=100)
    lat: float
    lng: float


@app.post("/api/dev/facilities")
def ingest_facilities(items: list[FacilityIn], request: Request):
    """개발용: 브라우저(카카오 JS SDK)로 수집한 시설을 저장. ALLOW_DEV_INGEST=1 이고 같은 PC에서 온 요청만 허용"""
    if os.getenv("ALLOW_DEV_INGEST") != "1" or (request.client and request.client.host not in ("127.0.0.1", "::1")):
        raise HTTPException(404)
    with get_conn() as conn:
        conn.executemany(
            "INSERT OR IGNORE INTO facilities (kakao_id, type_key, name, lat, lng) VALUES (?,?,?,?,?)",
            [(i.kakao_id, i.type_key, i.name, i.lat, i.lng) for i in items],
        )
        total = conn.execute("SELECT COUNT(*) FROM facilities").fetchone()[0]
    return {"received": len(items), "total": total}


@app.get("/api/zones/{zone_id}")
def get_zone(zone_id: int):
    """구역 상세 + 후기(사진 포함)"""
    with get_conn() as conn:
        zone = conn.execute("SELECT * FROM zones WHERE id = ?", (zone_id,)).fetchone()
        if not zone:
            raise HTTPException(404, "구역을 찾을 수 없습니다")
        reviews = [
            dict(r)
            for r in conn.execute(
                "SELECT id, author, rating, content, created_at FROM reviews WHERE zone_id = ? ORDER BY id DESC",
                (zone_id,),
            )
        ]
        for rv in reviews:
            # 샘플 후기는 외부 더미 이미지 주소(http...)를 그대로, 업로드 사진은 서버 경로로 변환
            rv["photos"] = [
                p["filename"] if p["filename"].startswith("http") else f"/api/uploads/{p['filename']}"
                for p in conn.execute("SELECT filename FROM review_photos WHERE review_id = ? ORDER BY id", (rv["id"],))
            ]
    avg = round(sum(r["rating"] for r in reviews) / len(reviews), 1) if reviews else None
    return {"zone": dict(zone), "review_count": len(reviews), "avg_rating": avg, "reviews": reviews}


@app.post("/api/zones/{zone_id}/reviews", status_code=201)
async def create_review(
    zone_id: int,
    author: str = Form(..., min_length=1, max_length=20),
    rating: int = Form(..., ge=1, le=5),
    content: str = Form(..., min_length=1, max_length=500),
    photos: list[UploadFile] = File(default=[]),
):
    author, content = author.strip(), content.strip()
    if not author or not content:
        raise HTTPException(422, "닉네임과 후기 내용을 입력해 주세요")
    photos = [p for p in photos if p.filename]  # 비어 있는 파일 입력 제외
    if len(photos) > MAX_PHOTOS:
        raise HTTPException(422, f"사진은 최대 {MAX_PHOTOS}장까지 올릴 수 있습니다")

    # 파일을 먼저 모두 검증한 뒤에 저장 (일부만 저장되는 상황 방지)
    validated: list[tuple[bytes, str]] = []
    for p in photos:
        data = await p.read(MAX_PHOTO_BYTES + 1)
        if len(data) > MAX_PHOTO_BYTES:
            raise HTTPException(413, "사진 한 장은 5MB 이하여야 합니다")
        ext = sniff_image_ext(data)
        if not ext:
            raise HTTPException(415, "JPG, PNG, WEBP 이미지만 올릴 수 있습니다")
        validated.append((data, ext))

    with get_conn() as conn:
        zone = conn.execute("SELECT type FROM zones WHERE id = ?", (zone_id,)).fetchone()
        if not zone:
            raise HTTPException(404, "구역을 찾을 수 없습니다")
        if zone["type"] != "smoking":
            raise HTTPException(403, "후기는 흡연구역에만 남길 수 있습니다")
        cur = conn.execute(
            "INSERT INTO reviews (zone_id, author, rating, content) VALUES (?,?,?,?)",
            (zone_id, author, rating, content),
        )
        review_id = cur.lastrowid
        for data, ext in validated:
            name = f"{uuid.uuid4().hex}{ext}"  # 원본 파일명은 쓰지 않음
            (UPLOAD_DIR / name).write_bytes(data)
            conn.execute("INSERT INTO review_photos (review_id, filename) VALUES (?,?)", (review_id, name))
    return {"id": review_id}


# ---- 길찾기 (카카오맵 도보·대중교통 / 카카오모빌리티 자동차) ----
# 모두 같은 카카오 REST API 키(KAKAO_REST_API_KEY)를 씀. 무료 사용량을 넘기지 않도록 캐시 + 종류별 하루 자체 한도
KAKAO_WALK_URL = "https://dapi.kakao.com/v2/routing/walk"
KAKAO_TRANSIT_URL = "https://dapi.kakao.com/v2/routing/publictraffic"
KAKAO_CAR_URL = "https://apis-navi.kakaomobility.com/v1/directions"
DAILY_LIMIT = 950  # 종류별 (카카오 무료 사용량 하루 1,000건보다 조금 적게)
# 서버를 다시 켜도 오늘 쓴 횟수가 이어지도록 파일에 저장 (.cache/는 git 제외)
USAGE_FILE = Path(__file__).parent / ".cache" / "route_usage.json"
MAX_ROUTE_M = {"walk": 10_000, "transit": 100_000, "car": 200_000}  # 직선거리가 이보다 멀면 부르지 않음
MODE_LABEL = {"walk": "도보", "transit": "대중교통", "car": "자동차"}
_route_cache: dict[tuple, dict] = {}


def straight_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = math.radians
    h = math.sin(r(lat2 - lat1) / 2) ** 2 + math.cos(r(lat1)) * math.cos(r(lat2)) * math.sin(r(lng2 - lng1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


MAX_DETOUR_M = 1500  # 흡연모드: 직선 기준으로 이보다 더 돌아가야 하는 흡연구역은 후보에서 제외
NEAR_M = 50  # 출발지·도착지에서 이 거리 안의 흡연구역은 경유지 후보에서 제외


def smoking_candidates(from_lat: float, from_lng: float, to_lat: float, to_lng: float, limit: int = 3) -> list[dict]:
    """출발→도착 사이에 들르기 좋은 흡연구역 (직선 기준 덜 돌아가는 순)"""
    pad = 0.015  # 약 1.5km
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, name, lat, lng FROM zones WHERE type = 'smoking'"
            " AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?",
            (min(from_lat, to_lat) - pad, max(from_lat, to_lat) + pad,
             min(from_lng, to_lng) - pad, max(from_lng, to_lng) + pad),
        ).fetchall()
    direct = straight_m(from_lat, from_lng, to_lat, to_lng)
    out = []
    for z in rows:
        to_start = straight_m(from_lat, from_lng, z["lat"], z["lng"])
        to_end = straight_m(z["lat"], z["lng"], to_lat, to_lng)
        if min(to_start, to_end) < NEAR_M:  # 출발지·도착지가 이미 흡연구역이면 들를 필요 없음
            continue
        detour = to_start + to_end - direct
        if detour <= MAX_DETOUR_M:
            out.append({**dict(z), "detour_m": round(detour)})
    return sorted(out, key=lambda z: z["detour_m"])[:limit]


def _load_usage() -> dict:
    """{"date": "2026-10-19", "walk": 3, "transit": 2, "car": 2} — 날짜가 바뀌면 0부터"""
    today = date.today().isoformat()
    try:
        usage = json.loads(USAGE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        usage = {}
    return usage if usage.get("date") == today else {"date": today}


def _count_call(mode: str) -> None:
    """카카오를 실제로 부르기 직전에 호출. 오늘 이 종류를 DAILY_LIMIT번 썼으면 부르지 않고 막음"""
    usage = _load_usage()
    if usage.get(mode, 0) >= DAILY_LIMIT:
        raise HTTPException(429, f"오늘 {MODE_LABEL[mode]} 길찾기 사용량({DAILY_LIMIT}건)을 모두 썼어요. 내일 다시 시도해 주세요")
    usage[mode] = usage.get(mode, 0) + 1
    USAGE_FILE.parent.mkdir(exist_ok=True)
    USAGE_FILE.write_text(json.dumps(usage), encoding="utf-8")


async def _kakao_get(url: str, key: str, params: dict) -> dict:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(url, headers={"Authorization": f"KakaoAK {key}"}, params=params)
    except httpx.HTTPError:
        raise HTTPException(502, "길찾기 서버에 연결하지 못했습니다")
    if res.status_code == 429:
        raise HTTPException(429, "오늘 길찾기 사용량을 모두 썼어요. 내일 다시 시도해 주세요")
    if res.status_code in (401, 403):
        raise HTTPException(502, "카카오 길찾기 권한이 없어요. REST API 키와 카카오맵 API 활성화 상태를 확인해 주세요")
    if res.status_code != 200:
        msg = res.json().get("msg") if "json" in res.headers.get("content-type", "") else None
        raise HTTPException(502, f"경로를 찾지 못했습니다{f' ({msg})' if msg else ''}")
    return res.json()


def _latlng(points) -> list[list[float]]:
    """[[x(경도), y(위도)], ...] → [[위도, 경도], ...]"""
    return [[y, x] for x, y in points]


ROUTE_ERRORS = {
    "SAME_POINT": "출발지와 도착지가 같아요",
    "TOO_FAR_AWAY": "너무 멀어서 경로를 찾을 수 없어요",
    "START_LINK_NOT_FOUND": "출발지 근처에서 길을 찾지 못했어요",
    "END_LINK_NOT_FOUND": "도착지 근처에서 길을 찾지 못했어요",
    "ROUTE_RESULT_NOT_FOUND": "경로를 찾지 못했어요",
}


async def walk_route(key: str, frm: tuple, to: tuple, via: dict | None) -> dict:
    params = {"start_x": frm[1], "start_y": frm[0], "end_x": to[1], "end_y": to[0]}
    if via:
        params.update(via_x=via["lng"], via_y=via["lat"])
    data = await _kakao_get(KAKAO_WALK_URL, key, params)
    if data.get("status") != "OK":
        raise HTTPException(422, ROUTE_ERRORS.get(data.get("status"), "경로를 찾지 못했어요"))
    route = data["route"]
    path: list[list[float]] = []
    for leg in route.get("legs", []):
        for step in leg.get("steps", []):
            for p in _latlng(step.get("path", {}).get("points", [])):
                if not path or path[-1] != p:
                    path.append(p)
    props = route["properties"]
    return {"distance_m": props["totalDistance"], "time_s": props["totalTime"], "path": path}


def _fare(fare) -> int | None:
    """요금: 실제 응답은 {"value": 1550}. 형식이 바뀌어도 숫자 필드를 찾아 씀"""
    if isinstance(fare, (int, float)):
        return int(fare)
    if isinstance(fare, dict):
        for k in ("value", "total", "card", "regular", "cash"):
            if isinstance(fare.get(k), (int, float)):
                return int(fare[k])
        nums = [v for v in fare.values() if isinstance(v, (int, float))]
        return int(nums[0]) if nums else None
    return None


async def transit_route(key: str, frm: tuple, to: tuple) -> dict:
    params = {"start_x": frm[1], "start_y": frm[0], "end_x": to[1], "end_y": to[0]}
    data = await _kakao_get(KAKAO_TRANSIT_URL, key, params)
    if data.get("status") != "OK" or not data.get("routes"):
        raise HTTPException(422, ROUTE_ERRORS.get(data.get("status"), "대중교통 경로를 찾지 못했어요"))
    # 경로가 10개 넘게 오기도 해서 빠른 순으로 3개만
    routes = sorted(data["routes"], key=lambda r: r.get("properties", {}).get("totalTime") or 1e9)[:3]
    options = []
    for r in routes:
        props = r.get("properties", {})
        steps = r.get("steps") or [s for leg in r.get("legs", []) for s in leg.get("steps", [])]
        segments = []
        for s in steps:
            sp = s.get("properties", s)
            stops = [st.get("name") for st in sp.get("stops", []) if st.get("name")]
            vehicles = [v.get("name") for v in sp.get("vehicles", []) if v.get("name")]
            segments.append({
                "type": sp.get("type"),  # WALKING / BUS / SUBWAY
                "guidance": sp.get("guidance"),
                "distance_m": sp.get("distance"),
                "time_s": sp.get("time"),
                "from": stops[0] if stops else None,
                "to": stops[-1] if len(stops) > 1 else None,
                "stop_count": max(len(stops) - 1, 0),
                "vehicles": vehicles,
                "path": _latlng(s.get("path", {}).get("points", [])),
            })
        options.append({
            "type": props.get("type"),
            "distance_m": props.get("totalDistance"),
            "time_s": props.get("totalTime"),
            "transfers": props.get("transfers"),
            "fare": _fare(props.get("fare")),
            "segments": segments,
            "path": [p for seg in segments for p in seg["path"]],
        })
    return {**{k: options[0][k] for k in ("distance_m", "time_s", "path")}, "options": options}


async def car_route(key: str, frm: tuple, to: tuple, via: dict | None) -> dict:
    params = {"origin": f"{frm[1]},{frm[0]}", "destination": f"{to[1]},{to[0]}", "priority": "RECOMMEND"}
    if via:
        params["waypoints"] = f"{via['lng']},{via['lat']}"
    data = await _kakao_get(KAKAO_CAR_URL, key, params)
    route = (data.get("routes") or [{}])[0]
    if route.get("result_code") != 0:
        raise HTTPException(422, route.get("result_msg") or "자동차 경로를 찾지 못했어요")
    path: list[list[float]] = []
    for sec in route.get("sections", []):
        for road in sec.get("roads", []):
            v = road.get("vertexes", [])
            for p in _latlng(zip(v[0::2], v[1::2])):  # [x1, y1, x2, y2, ...]
                if not path or path[-1] != p:
                    path.append(p)
    summary = route["summary"]
    fare = summary.get("fare", {})
    return {"distance_m": summary["distance"], "time_s": summary["duration"], "path": path,
            "toll": fare.get("toll"), "taxi": fare.get("taxi")}


@app.get("/api/route/usage")
def route_usage():
    """오늘 길찾기 종류별 사용량 (카카오 호출 횟수, 캐시로 응답한 건은 제외)"""
    usage = _load_usage()
    return {"date": usage["date"], "limit": DAILY_LIMIT, **{m: usage.get(m, 0) for m in MODE_LABEL}}


@app.get("/api/route")
async def find_route(
    from_lat: float = Query(..., ge=33, le=39),
    from_lng: float = Query(..., ge=124, le=132),
    to_lat: float = Query(..., ge=33, le=39),
    to_lng: float = Query(..., ge=124, le=132),
    mode: Literal["walk", "transit", "car"] = Query("walk", description="도보 / 대중교통 / 자동차"),
    smoking: bool = Query(False, description="흡연모드: 중간에 흡연구역을 들렀다 감 (도보·자동차만)"),
    via_zone_id: int | None = Query(None, description="흡연모드에서 들를 흡연구역을 직접 고를 때"),
):
    """출발 → (흡연구역) → 도착 경로. path는 [[lat, lng], ...]"""
    key = os.getenv("KAKAO_REST_API_KEY", "").strip()
    if not key:
        raise HTTPException(503, "길찾기 키가 설정되지 않았습니다 (backend/.env의 KAKAO_REST_API_KEY)")

    dist = straight_m(from_lat, from_lng, to_lat, to_lng)
    if dist > MAX_ROUTE_M[mode]:
        raise HTTPException(422, f"{MODE_LABEL[mode]} 길찾기는 직선 {MAX_ROUTE_M[mode] // 1000}km 이내만 안내해요")
    if dist < 10:
        raise HTTPException(422, "출발지와 도착지가 너무 가까워요")

    # 흡연모드: 대중교통 API는 경유지를 지원하지 않아 도보·자동차에만 적용
    via = None
    candidates: list[dict] = []
    if smoking and mode != "transit":
        candidates = smoking_candidates(from_lat, from_lng, to_lat, to_lng)
        via = next((c for c in candidates if c["id"] == via_zone_id), None) if via_zone_id else None
        via = via or (candidates[0] if candidates else None)

    # 좌표를 약 10m 단위로 반올림해서 같은 요청은 캐시로 응답
    frm, to = (from_lat, from_lng), (to_lat, to_lng)
    cache_key = (mode, *(round(v, 4) for v in (*frm, *to)), via and via["id"])
    if cache_key not in _route_cache:
        _count_call(mode)
        if mode == "walk":
            _route_cache[cache_key] = await walk_route(key, frm, to, via)
        elif mode == "transit":
            _route_cache[cache_key] = await transit_route(key, frm, to)
        else:
            _route_cache[cache_key] = await car_route(key, frm, to, via)
    result = {**_route_cache[cache_key], "mode": mode, "via": via}
    if smoking:
        result["candidates"] = candidates  # 다른 흡연구역으로 바꿀 수 있게
        result["smoking_supported"] = mode != "transit"
    return result
