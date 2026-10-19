import json
import math
import os
import uuid
from datetime import date
from pathlib import Path
from typing import Literal
from urllib.parse import quote

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


# ---- 도보 길찾기 (TMAP 보행자 경로안내) ----
# 무료 요금제는 하루 1,000건, 넘으면 TMAP이 차단하므로 캐시 + 자체 한도로 아껴 씀
TMAP_URL = "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1"
TMAP_DAILY_LIMIT = 950
MAX_ROUTE_M = 10000  # 직선거리가 이보다 멀면 TMAP을 부르지 않음
_route_cache: dict[tuple, dict] = {}
_tmap_calls = {"date": date.today(), "count": 0}


def straight_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = math.radians
    h = math.sin(r(lat2 - lat1) / 2) ** 2 + math.cos(r(lat1)) * math.cos(r(lat2)) * math.sin(r(lng2 - lng1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


MAX_DETOUR_M = 1500  # 흡연모드: 직선 기준으로 이보다 더 돌아가야 하는 흡연구역은 후보에서 제외


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
        detour = straight_m(from_lat, from_lng, z["lat"], z["lng"]) + straight_m(z["lat"], z["lng"], to_lat, to_lng) - direct
        if detour <= MAX_DETOUR_M:
            out.append({**dict(z), "detour_m": round(detour)})
    return sorted(out, key=lambda z: z["detour_m"])[:limit]


async def tmap_route(key: str, from_lat: float, from_lng: float, to_lat: float, to_lng: float, via: dict | None) -> dict:
    if _tmap_calls["date"] != date.today():
        _tmap_calls.update(date=date.today(), count=0)
    if _tmap_calls["count"] >= TMAP_DAILY_LIMIT:
        raise HTTPException(429, "오늘 길찾기 사용량을 모두 썼어요. 내일 다시 시도해 주세요")
    _tmap_calls["count"] += 1

    body = {
        "startX": str(from_lng), "startY": str(from_lat),
        "endX": str(to_lng), "endY": str(to_lat),
        "startName": quote("출발"), "endName": quote("도착"),
        "reqCoordType": "WGS84GEO", "resCoordType": "WGS84GEO",
    }
    if via:
        body["passList"] = f"{via['lng']},{via['lat']}"  # 경유지 (경도,위도)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.post(TMAP_URL, headers={"appKey": key}, json=body)
    except httpx.HTTPError:
        raise HTTPException(502, "길찾기 서버에 연결하지 못했습니다")
    if res.status_code == 429:
        raise HTTPException(429, "오늘 길찾기 사용량을 모두 썼어요. 내일 다시 시도해 주세요")
    if res.status_code != 200:
        msg = (res.json().get("error", {}).get("message") if "json" in res.headers.get("content-type", "") else None)
        raise HTTPException(502, f"경로를 찾지 못했습니다{f' ({msg})' if msg else ''}")

    features = res.json().get("features", [])
    if not features:
        raise HTTPException(502, "경로를 찾지 못했습니다")
    path: list[list[float]] = []
    for f in features:
        if f["geometry"]["type"] == "LineString":
            for lng, lat in f["geometry"]["coordinates"]:
                if not path or path[-1] != [lat, lng]:  # 구간 이음새 중복 제거
                    path.append([lat, lng])
    props = features[0]["properties"]
    return {"distance_m": props.get("totalDistance"), "time_s": props.get("totalTime"), "path": path}


@app.get("/api/route")
async def walking_route(
    from_lat: float = Query(..., ge=33, le=39),
    from_lng: float = Query(..., ge=124, le=132),
    to_lat: float = Query(..., ge=33, le=39),
    to_lng: float = Query(..., ge=124, le=132),
    smoking: bool = Query(False, description="흡연모드: 중간에 흡연구역을 들렀다 감"),
    via_zone_id: int | None = Query(None, description="흡연모드에서 들를 흡연구역을 직접 고를 때"),
):
    """출발 → (흡연구역) → 도착 도보 경로. path는 [[lat, lng], ...]"""
    key = os.getenv("TMAP_APP_KEY", "").strip()
    if not key:
        raise HTTPException(503, "길찾기 키가 설정되지 않았습니다 (backend/.env의 TMAP_APP_KEY)")

    dist = straight_m(from_lat, from_lng, to_lat, to_lng)
    if dist > MAX_ROUTE_M:
        raise HTTPException(422, f"도보 길찾기는 직선 {MAX_ROUTE_M // 1000}km 이내만 안내해요")
    if dist < 10:
        raise HTTPException(422, "출발지와 도착지가 너무 가까워요")

    via = None
    candidates: list[dict] = []
    if smoking:
        candidates = smoking_candidates(from_lat, from_lng, to_lat, to_lng)
        via = next((c for c in candidates if c["id"] == via_zone_id), None) if via_zone_id else None
        via = via or (candidates[0] if candidates else None)

    # 좌표를 약 10m 단위로 반올림해서 같은 요청은 캐시로 응답
    cache_key = (round(from_lat, 4), round(from_lng, 4), round(to_lat, 4), round(to_lng, 4), via and via["id"])
    if cache_key not in _route_cache:
        _route_cache[cache_key] = await tmap_route(key, from_lat, from_lng, to_lat, to_lng, via)
    result = {**_route_cache[cache_key], "via": via}
    if smoking:
        result["candidates"] = candidates  # 다른 흡연구역으로 바꿀 수 있게
    return result
