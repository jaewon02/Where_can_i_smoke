"""금연 규칙 대상 시설(facilities 테이블) 도구

    python facilities_tool.py build  --region gangnam [--refresh]   # 시설 경계선(OSM)을 찾아 금연 구역 계산 -> DB
    python facilities_tool.py streets --region gangnam [--refresh]  # 구청이 지정한 금연거리(data/streets_gangnam.json) -> 도로 위 구역
    python facilities_tool.py export --region gangnam               # DB -> data/facilities_gangnam.json
    python facilities_tool.py load   [--region gangnam]             # data/facilities_*.json -> DB (지역 생략하면 전부)

지역(--region): songpa(송파구), gangnam(강남구). 새 지역은 REGIONS에 영역(bbox)만 추가하면 됩니다.

시설 위치는 카카오 장소 검색으로 해당 구 전체를 구역별로 모은 것입니다 (수집 방법: tools/collect_facilities.js).
카카오는 시설의 '점' 위치만 주기 때문에, 금연 거리를 시설 경계선에서 재려고 오픈스트리트맵(OSM)의 윤곽선을 씁니다.
  - 카카오 시설 점이 OSM 윤곽선(학교, 어린이집, 병원, 도서관, 공원, 놀이터) 안에 있으면 그 윤곽선을 시설 경계로 보고,
    경계선 바깥으로 법정 거리만큼 넓힌 다각형을 금연 구역(area)으로 저장합니다.
  - 시설 윤곽선이 없으면(주로 상가 건물에 입점한 어린이집·유치원) 점이 들어 있는 OSM 건물 윤곽선을 시설 경계로 봅니다.
  - 그것도 못 찾으면 점 위치 + 근사 반경(r)을 씁니다.
  - 지하철은 역 중심이 아니라 출입구 위치(10m)를 씁니다. OSM 출입구 좌표는 카카오 지도의 출구 아이콘과 평균 14m
    어긋나서, 카카오에서 같은 출구가 검색되면 그 위치로 맞춥니다 (KAKAO_REST_API_KEY 필요, 없으면 OSM 좌표 그대로).
저장소에 JSON이 들어 있어서, 새로 받은 PC에서는 `load` 한 번이면 카카오/OSM 접속 없이 같은 데이터를 쓸 수 있습니다.

지도 데이터: © OpenStreetMap contributors (ODbL)  https://www.openstreetmap.org/copyright
"""
import json
import math
import os
import re
import sys
import time
from pathlib import Path

import httpx
import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon, mapping
from shapely.ops import linemerge, polygonize, unary_union
from shapely.strtree import STRtree

from dotenv import load_dotenv

from db import get_conn, init_db

load_dotenv(Path(__file__).parent / ".env")

DATA_DIR = Path(__file__).parent / "data"
CACHE_DIR = Path(__file__).parent / ".cache"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
# 지역별 영역 (남, 서, 북, 동). 해당 구와 주변을 덮도록 넉넉하게 잡음 (이웃 구 시설은 수집 단계에서 주소로 걸러냄)
REGIONS = {
    "songpa": {"name": "송파구", "bbox": (37.455, 127.07, 37.545, 127.19)},
    "gangnam": {"name": "강남구", "bbox": (37.455, 127.005, 37.545, 127.125)},
}


def region_files(region: str) -> tuple[Path, Path]:
    return DATA_DIR / f"facilities_{region}.json", CACHE_DIR / f"osm_{region}.json"


def get_region(argv: list[str]) -> str:
    if "--region" not in argv or argv.index("--region") + 1 >= len(argv) or argv[argv.index("--region") + 1] not in REGIONS:
        sys.exit(f"--region 을 지정하세요: {', '.join(REGIONS)}")
    return argv[argv.index("--region") + 1]


def in_bbox_sql(bbox) -> tuple[str, tuple]:
    s_, w_, n_, e_ = bbox
    return "lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?", (s_, n_, w_, e_)

# type_key -> (경계선에서 넓힐 거리 m, 경계선을 모를 때 쓰는 근사 반경 m)
#   어린이집/유치원/학교: 시설 경계선 30m 이내 (국민건강증진법)
#   병원/도서관/청사/공원/놀이터: 시설(건물+대지) 자체가 금연이라 주변으로 넓히지 않음 (0)
#   지하철 출입구/버스정류장: 조례 기준 10m
#   근사 반경 = 경계선을 모를 때만 쓰는 값: 법정 거리 + 시설 크기 추정치.
#     '시설 자체' 유형은 주변으로 넓히지 않고 시설 크기 추정치만 씀
RULES = {
    "childcare": (30, 45),
    "kindergarten": (30, 45),
    "elementary": (30, 80),
    "middle": (30, 80),
    "high": (30, 80),
    "playground": (0, 12),
    "hospital": (0, 25),
    "library": (0, 15),
    "office-community": (0, 15),
    "office-district": (0, 25),
    "park": (0, 20),
    "bus": (10, 10),
    "subway-exit": (10, 10),
}
# type_key -> 카카오 점이 들어 있어야 하는 OSM 윤곽선 종류
OSM_GROUPS = {
    "childcare": ("amenity", {"childcare", "kindergarten"}),
    "kindergarten": ("amenity", {"childcare", "kindergarten"}),
    "elementary": ("amenity", {"school"}),
    "middle": ("amenity", {"school"}),
    "high": ("amenity", {"school"}),
    "hospital": ("amenity", {"hospital"}),
    "library": ("amenity", {"library"}),
    "park": ("leisure", {"park"}),
    "playground": ("leisure", {"playground"}),
}
EXTRA_FROM_OSM = {"park", "playground"}  # 카카오에 없는 OSM 윤곽선도 시설로 추가할 종류
MAX_FOOTPRINT_M2 = 300_000  # 공원/놀이터가 아닌데 이보다 크면 엉뚱한 윤곽선으로 보고 무시
MIN_FOOTPRINT_M2 = 30
# 윤곽선 없는 시설에 건물 윤곽선을 적용할 유형. 병원은 병원급(이름 기준)만 (의원·치과는 그리지 않으니까)
BUILDING_TYPES = {"childcare", "kindergarten", "library", "office-community", "office-district", "hospital"}
HOSPITAL_DRAWN = re.compile("병원|의료원|보건소|보건지소")
MAX_BUILDING_M2 = 40_000  # 이보다 큰 건물은 단지/공장 등 엉뚱한 윤곽선으로 보고 무시
BUILDING_NEAR_M = 8  # 점이 건물 안에 없으면 이 거리 안의 가장 가까운 건물
EXIT_KAKAO_MAX_M = 80  # OSM 출입구와 이 거리 안에서 찾은 카카오 출구만 같은 출구로 인정
STATION_MAX_M = 250  # 출입구와 가장 가까운 카카오 지하철역이 이 거리 안이어야 해당 구 역으로 인정

# 위도/경도 <-> 미터 변환 (서울 동남권 일대에서는 평면 근사로 충분)
LAT0, LNG0 = 37.5, 127.12
KY = 111_320.0
KX = KY * math.cos(math.radians(LAT0))
to_m = lambda a: np.column_stack(((a[:, 0] - LNG0) * KX, (a[:, 1] - LAT0) * KY))  # noqa: E731  (lng,lat -> m)
to_ll = lambda a: np.column_stack((a[:, 0] / KX + LNG0, a[:, 1] / KY + LAT0))  # noqa: E731  (m -> lng,lat)
pt_m = lambda lng, lat: ((lng - LNG0) * KX, (lat - LAT0) * KY)  # noqa: E731


def fetch_osm(region: str, refresh: bool) -> dict:
    """Overpass API에서 윤곽선/출입구를 받아 캐시 (없거나 --refresh일 때만 호출)"""
    _, cache = region_files(region)
    if cache.exists() and not refresh:
        return json.loads(cache.read_text(encoding="utf-8"))
    s, w, n, e = REGIONS[region]["bbox"]
    box = f"({s},{w},{n},{e})"
    query = f"""[out:json][timeout:90];
(
  nwr["amenity"~"^(school|kindergarten|childcare|hospital|library)$"]{box};
  nwr["leisure"~"^(park|playground)$"]{box};
  node["railway"="subway_entrance"]{box};
  node["highway"="bus_stop"]{box};
);
out tags geom;"""
    resp = httpx.post(
        OVERPASS_URL,
        data={"data": query},
        headers={"User-Agent": "smoking-zone-map-dev/0.1", "Accept": "application/json"},
        timeout=150,
    )
    resp.raise_for_status()
    cache.parent.mkdir(exist_ok=True)
    cache.write_text(resp.text, encoding="utf-8")
    return resp.json()


def osm_polygons(elements: list[dict]) -> list[dict]:
    """OSM way/relation -> 미터 좌표계의 shapely 폴리곤 목록"""
    out = []
    for el in elements:
        tags = el.get("tags", {})
        key = "amenity" if "amenity" in tags else "leisure" if "leisure" in tags else None
        if not key:
            continue
        poly = None
        try:
            if el["type"] == "way" and el.get("geometry"):
                pts = [(g["lon"], g["lat"]) for g in el["geometry"]]
                if len(pts) >= 4 and pts[0] == pts[-1]:
                    poly = Polygon(pts)
            elif el["type"] == "relation":
                lines = [
                    LineString([(g["lon"], g["lat"]) for g in m["geometry"]])
                    for m in el.get("members", [])
                    if m.get("role") == "outer" and m.get("geometry")
                ]
                if lines:
                    poly = unary_union(list(polygonize(linemerge(lines))))
            if poly is None or poly.is_empty:
                continue
            poly = shapely.transform(poly, to_m)
            if not poly.is_valid:
                poly = poly.buffer(0)
            if poly.is_empty:
                continue
        except (KeyError, ValueError):
            continue
        out.append({"id": f"{el['type']}/{el['id']}", "key": key, "value": tags[key], "name": tags.get("name"), "geom": poly})
    return out


def to_area_json(geom_m, buffer_m: float) -> str | None:
    """경계선(미터 좌표)에서 buffer_m 만큼 넓혀 단순화한 뒤 [[[ [lng,lat],... ]]] (MultiPolygon) JSON으로"""
    g = geom_m.buffer(buffer_m, resolution=6) if buffer_m > 0 else geom_m
    g = g.simplify(1.5, preserve_topology=True)
    if g.is_empty:
        return None
    polys = [g] if g.geom_type == "Polygon" else [p for p in getattr(g, "geoms", []) if p.geom_type == "Polygon"]
    result = []
    for p in polys:
        rings = [p.exterior.coords, *[i.coords for i in p.interiors]]
        result.append([[[round(x, 6), round(y, 6)] for x, y in shapely.transform(LineString(r), to_ll).coords] for r in rings])
    return json.dumps(result, separators=(",", ":")) if result else None


def fetch_buildings(region: str, points: list[tuple[float, float]], refresh: bool) -> list[dict]:
    """시설 점 주변(40m)의 OSM 건물 윤곽선(way)을 받아 캐시. 150개 점씩 나눠 요청"""
    cache = CACHE_DIR / f"buildings_{region}.json"
    if cache.exists() and not refresh:
        return json.loads(cache.read_text(encoding="utf-8"))
    found: dict[int, dict] = {}
    for i in range(0, len(points), 150):
        chunk = points[i : i + 150]
        parts = "".join(f'way(around:40,{lat:.6f},{lng:.6f})["building"];' for lat, lng in chunk)
        query = f"[out:json][timeout:120];({parts});out tags geom;"
        for attempt in range(4):
            resp = httpx.post(
                OVERPASS_URL, data={"data": query}, headers={"User-Agent": "smoking-zone-map-dev/0.1", "Accept": "application/json"}, timeout=180
            )
            if resp.status_code == 200:
                break
            time.sleep(5 * (attempt + 1))
        resp.raise_for_status()
        for el in resp.json()["elements"]:
            found[el["id"]] = {"id": el["id"], "geometry": el.get("geometry")}
        print(f"  건물 윤곽선 조회 {min(i + 150, len(points))}/{len(points)} (누적 {len(found)}개)", flush=True)
        time.sleep(2)
    cache.parent.mkdir(exist_ok=True)
    out = list(found.values())
    cache.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    return out


def building_polygons(elements: list[dict]) -> list:
    """OSM 건물 way -> 미터 좌표계 폴리곤 (닫히지 않은 선, 너무 작거나 큰 것은 제외)"""
    out = []
    for el in elements:
        pts = [(g["lon"], g["lat"]) for g in (el.get("geometry") or [])]
        if len(pts) < 4 or pts[0] != pts[-1]:
            continue
        try:
            poly = shapely.transform(Polygon(pts), to_m)
            if not poly.is_valid:
                poly = poly.buffer(0)
        except ValueError:
            continue
        if not poly.is_empty and poly.geom_type == "Polygon" and MIN_FOOTPRINT_M2 <= poly.area <= MAX_BUILDING_M2:
            out.append(poly)
    return out


def kakao_exit_positions(region: str, exits: list[dict], refresh: bool) -> dict[str, tuple[float, float]]:
    """OSM 출입구 id -> 카카오 지도에 보이는 같은 출구의 (lat, lng). 못 찾은 출구는 빠짐. 결과는 캐시"""
    cache = CACHE_DIR / f"kakao_exits_{region}.json"
    done = json.loads(cache.read_text(encoding="utf-8")) if cache.exists() and not refresh else {}
    key = os.getenv("KAKAO_REST_API_KEY", "").strip()
    if not key:
        if not done:
            print("KAKAO_REST_API_KEY 가 없어 출입구 위치를 OSM 좌표 그대로 씁니다")
        return {k: tuple(v) for k, v in done.items() if v}
    pending = [e for e in exits if e["id"] not in done]
    for n, e in enumerate(pending, 1):
        m = re.match(r"(.+?역)\s.*?(\d+)번 출입구$", e["name"])
        pos = None
        if m:
            station, num = m.groups()
            resp = httpx.get(
                "https://dapi.kakao.com/v2/local/search/keyword.json",
                params={"query": f"{station} {num}번 출구", "x": e["lng"], "y": e["lat"], "radius": 300, "size": 5},
                headers={"Authorization": f"KakaoAK {key}"},
                timeout=20,
            )
            if resp.status_code == 200:
                best = None
                for d in resp.json().get("documents", []):
                    # '강남역 신분당선 5번출구' 형태만 ('일원역1번출구약국' 같은 가게 이름은 제외)
                    if not re.fullmatch(rf"{re.escape(station)}\s*(\S+선\s*)?{num}번\s*출구", d["place_name"]):
                        continue
                    dist = math.hypot((float(d["x"]) - e["lng"]) * KX, (float(d["y"]) - e["lat"]) * KY)
                    if dist <= EXIT_KAKAO_MAX_M and (best is None or dist < best[0]):
                        best = (dist, float(d["y"]), float(d["x"]))
                if best:
                    pos = [best[1], best[2]]
            elif resp.status_code in (401, 403, 429):
                print(f"카카오 검색 실패({resp.status_code}) - 여기까지의 결과만 저장하고 멈춥니다")
                break
        done[e["id"]] = pos
        if n % 50 == 0:
            print(f"  카카오 출구 검색 {n}/{len(pending)}", flush=True)
        time.sleep(0.05)
    cache.parent.mkdir(exist_ok=True)
    cache.write_text(json.dumps(done), encoding="utf-8")
    return {k: tuple(v) for k, v in done.items() if v}


def build(region: str, refresh: bool) -> None:
    init_db()
    where, params_bbox = in_bbox_sql(REGIONS[region]["bbox"])
    osm = fetch_osm(region, refresh)
    elements = osm["elements"]
    polys = osm_polygons(elements)
    print(f"OSM 윤곽선 {len(polys)}개, 지하철 출입구 {sum(1 for e in elements if e.get('tags', {}).get('railway') == 'subway_entrance')}개")

    # 윤곽선 종류별 공간 인덱스
    trees: dict[tuple, tuple[list, STRtree]] = {}
    for group in {(k, frozenset(v)) for k, v in OSM_GROUPS.values()}:
        members = [p for p in polys if p["key"] == group[0] and p["value"] in group[1]]
        trees[group] = (members, STRtree([m["geom"] for m in members]))

    with get_conn() as conn:
        # 이전 빌드가 추가한 OSM 시설/출입구는 지우고 다시 만듦
        # (다른 지역 데이터는 건드리지 않도록 이 지역 영역 안의 것만)
        conn.execute(f"DELETE FROM facilities WHERE kakao_id LIKE 'osm:%' AND {where}", params_bbox)
        rows = [dict(r) for r in conn.execute(f"SELECT id, kakao_id, type_key, name, lat, lng FROM facilities WHERE {where}", params_bbox)]
        updates, used, matched = [], set(), 0
        for row in rows:
            rule = RULES.get(row["type_key"])
            if not rule:
                continue  # 지하철역 점 등 그리지 않는 항목
            buffer_m, fallback_r = rule
            area = None
            group = OSM_GROUPS.get(row["type_key"])
            if group:
                members, tree = trees[(group[0], frozenset(group[1]))]
                pt = Point(*pt_m(row["lng"], row["lat"]))
                hits = [members[i] for i in tree.query(pt, predicate="within")]
                big_ok = row["type_key"] in EXTRA_FROM_OSM
                hits = [h for h in hits if MIN_FOOTPRINT_M2 <= h["geom"].area <= (float("inf") if big_ok else MAX_FOOTPRINT_M2)]
                if hits:
                    best = min(hits, key=lambda h: h["geom"].area)  # 겹치면 가장 작은(구체적인) 윤곽선
                    area = to_area_json(best["geom"], buffer_m)
                    used.add(best["id"])
                    matched += 1
            updates.append([area, None if area else float(fallback_r), row["id"]])

        # 시설 윤곽선이 없는 시설(상가 건물에 입점한 어린이집 등)은 점이 들어 있는 건물 윤곽선을 경계로 씀
        by_id = {u[2]: u for u in updates}
        todo = [
            r for r in rows
            if r["type_key"] in BUILDING_TYPES and r["id"] in by_id and by_id[r["id"]][0] is None
            and (r["type_key"] != "hospital" or HOSPITAL_DRAWN.search(r["name"]))
        ]
        by_building = 0
        if todo:
            blds = building_polygons(fetch_buildings(region, [(r["lat"], r["lng"]) for r in todo], refresh))
            btree = STRtree(blds)
            for r in todo:
                pt = Point(*pt_m(r["lng"], r["lat"]))
                inside = [blds[i] for i in btree.query(pt, predicate="within")]
                if inside:
                    b = min(inside, key=lambda g: g.area)  # 겹치면 가장 작은(구체적인) 건물
                else:
                    near = [g for g in (blds[i] for i in btree.query(pt.buffer(BUILDING_NEAR_M))) if g.distance(pt) <= BUILDING_NEAR_M]
                    if not near:
                        continue
                    b = min(near, key=lambda g: g.distance(pt))
                area = to_area_json(b, RULES[r["type_key"]][0])
                if area:
                    by_id[r["id"]][0], by_id[r["id"]][1] = area, None
                    by_building += 1
        conn.executemany("UPDATE facilities SET area = ?, r = ? WHERE id = ?", [tuple(u) for u in updates])
        print(f"카카오 시설 {len(updates)}개 중 시설 윤곽선 매칭 {matched}개, 건물 윤곽선 {by_building}개 (나머지는 근사 반경)")

        # 카카오에 없는 공원/놀이터 윤곽선은 시설로 추가
        extras = []
        for p in polys:
            tk = "park" if p["value"] == "park" else "playground" if p["value"] == "playground" else None
            if not tk or p["id"] in used or p["geom"].area < MIN_FOOTPRINT_M2:
                continue
            area = to_area_json(p["geom"], RULES[tk][0])
            if not area:
                continue
            c = shapely.transform(p["geom"].representative_point(), to_ll)
            name = p["name"] or ("공원" if tk == "park" else "어린이놀이터")
            extras.append((f"osm:{p['id']}", tk, name, c.y, c.x, area, None))
        # 지하철 출입구: 역 중심이 아니라 출입구에서 10m. 이름은 가장 가까운 카카오 지하철역에서 가져옴
        stations = [(r["name"], Point(*pt_m(r["lng"], r["lat"]))) for r in rows if r["type_key"] == "subway"]
        exit_nodes = []
        for el in elements:
            if el.get("tags", {}).get("railway") != "subway_entrance" or el["type"] != "node":
                continue
            pt = Point(*pt_m(el["lon"], el["lat"]))
            if not stations:
                break
            name, st = min(stations, key=lambda s: s[1].distance(pt))
            if st.distance(pt) > STATION_MAX_M:
                continue  # 이 구 밖 역의 출입구
            ref = el["tags"].get("ref")
            exit_nodes.append({"id": f"osm:node/{el['id']}", "name": f"{name} {ref}번 출입구" if ref else f"{name} 출입구", "lat": el["lat"], "lng": el["lon"]})
        # OSM 출입구 좌표는 카카오 지도의 출구 아이콘과 어긋나므로, 카카오에서 같은 출구를 찾으면 그 위치로 맞춤
        kakao_pos = kakao_exit_positions(region, exit_nodes, refresh)
        for e in exit_nodes:
            lat, lng = kakao_pos.get(e["id"], (e["lat"], e["lng"]))
            extras.append((e["id"], "subway-exit", e["name"], lat, lng, None, 10.0))
        exits = len(exit_nodes)
        print(f"  출입구 {exits}개 중 카카오 위치로 맞춘 것 {len(kakao_pos)}개")
        # 버스정류장: 서울시 조례는 '버스정류소 및 택시 승차대'를 금연구역으로 지정하지만 거리 규정은 없음 -> 정류장 위치에 임시 반경
        buses = 0
        for el in elements:
            tags = el.get("tags", {})
            if tags.get("highway") != "bus_stop" or el["type"] != "node":
                continue
            nm = (tags.get("name") or "").strip()
            name = (nm if re.search("정류장|정류소", nm) else f"{nm} 버스정류장") if nm else "버스정류장"
            extras.append((f"osm:node/{el['id']}", "bus", name, el["lat"], el["lon"], None, float(RULES["bus"][1])))
            buses += 1
        conn.executemany(
            "INSERT OR REPLACE INTO facilities (kakao_id, type_key, name, lat, lng, area, r) VALUES (?,?,?,?,?,?,?)", extras
        )
        print(f"OSM에서 추가: 공원/놀이터 {len(extras) - exits - buses}개, 지하철 출입구 {exits}개, 버스정류장 {buses}개")
        total = conn.execute("SELECT COUNT(*) FROM facilities").fetchone()[0]
    print(f"완료: 시설 {total}개")


# ───────────────────────── 금연거리(조례로 지정한 거리) ─────────────────────────
# 구청이 공개한 구간 설명(시작점~끝점, 길이)을 OSM 도로 위의 구역으로 옮긴다. 정확한 보도 경계가 아니라 도로 중심선에서
# 양쪽으로 STREET_BUFFER_M 만큼 넓힌 근사 범위이며, 도로를 따라 잰 길이가 공식 길이와 맞는 구간만 그린다.
STREET_BUFFER_M = 14
STREET_RATIO_OK = (0.85, 1.20)  # 도로를 따라 잰 길이 / 공식 길이 허용 범위
ROAD_SKIP = {"service", "construction", "steps", "pedestrian", "footway", "path"}
SCHOOL_KEYS = ("elementary", "middle", "high")


def fetch_roads(region: str, names: list[str], refresh: bool) -> list[dict]:
    """금연거리에 나오는 도로 이름의 OSM 도로(way)를 받아 캐시"""
    cache = CACHE_DIR / f"roads_{region}.json"
    if cache.exists() and not refresh:
        saved = json.loads(cache.read_text(encoding="utf-8"))
        if set(names) <= set(saved["names"]):
            return saved["elements"]
    s_, w_, n_, e_ = REGIONS[region]["bbox"]
    pattern = "|".join(sorted(set(names)))
    query = (
        "[out:json][timeout:120];\n"
        f'way["highway"]["name"~"^({pattern})$"]({s_},{w_},{n_},{e_});\n'
        "out tags geom;"
    )
    for attempt in range(1, 4):  # Overpass 가 바쁠 때(502 등) 잠시 기다렸다 다시 시도
        resp = httpx.post(
            OVERPASS_URL, data={"data": query},
            headers={"User-Agent": "smoking-zone-map-dev/0.1", "Accept": "application/json"}, timeout=180,
        )
        if resp.status_code < 500 or attempt == 3:
            break
        time.sleep(20 * attempt)
    resp.raise_for_status()
    elements = resp.json()["elements"]
    cache.parent.mkdir(exist_ok=True)
    cache.write_text(json.dumps({"names": sorted(set(names)), "elements": elements}, ensure_ascii=False), encoding="utf-8")
    return elements


def _ways(elements: list[dict], name: str) -> list[dict]:
    return [e for e in elements if e["tags"].get("name") == name]


def _graph(ways: list[dict]):
    """도로 구간들을 좌표가 같은 점끼리 이어서 (그래프, 점 좌표) 로"""
    g: dict = {}
    pts: dict = {}
    for e in ways:
        if e["tags"].get("highway") in ROAD_SKIP:
            continue
        geom = [(round(p["lat"], 6), round(p["lon"], 6)) for p in e["geometry"]]
        for a, b in zip(geom, geom[1:]):
            pa, pb = pt_m(a[1], a[0]), pt_m(b[1], b[0])
            pts[a], pts[b] = pa, pb
            w = math.hypot(pa[0] - pb[0], pa[1] - pb[1])
            g.setdefault(a, []).append((b, w))
            g.setdefault(b, []).append((a, w))
    return g, pts


def _shortest(g, s, t):
    import heapq

    dist_, prev, pq = {s: 0.0}, {}, [(0.0, s)]
    while pq:
        c, u = heapq.heappop(pq)
        if u == t:
            break
        if c > dist_.get(u, 1e18):
            continue
        for v, w in g[u]:
            if c + w < dist_.get(v, 1e18):
                dist_[v], prev[v] = c + w, u
                heapq.heappush(pq, (c + w, v))
    if t not in dist_:
        return None
    path = [t]
    while path[-1] != s:
        path.append(prev[path[-1]])
    return path[::-1]


def road_path(ways: list[dict], a: dict, b: dict) -> LineString | None:
    """도로 이름이 같은 길 위에서 시작점~끝점을 잇는 최단 경로 (미터 좌표). 큰 도로는 방향별 차로가 따로 있어서
    차로(연결된 덩어리)마다 구해 두 점에 가장 가까운 쪽을 고름. 시작/끝점(출구 등)까지의 짧은 연결선도 포함"""
    g, pts = _graph(ways)
    comp: dict = {}
    n_comp = 0
    for start in g:  # 연결된 덩어리 나누기
        if start in comp:
            continue
        comp[start] = n_comp
        stack = [start]
        while stack:
            u = stack.pop()
            for v, _ in g[u]:
                if v not in comp:
                    comp[v] = n_comp
                    stack.append(v)
        n_comp += 1
    pa, pb = pt_m(a["lng"], a["lat"]), pt_m(b["lng"], b["lat"])
    best = None
    for c in range(n_comp):
        members = [k for k, v in comp.items() if v == c]
        ka = min(members, key=lambda k: math.hypot(pts[k][0] - pa[0], pts[k][1] - pa[1]))
        kb = min(members, key=lambda k: math.hypot(pts[k][0] - pb[0], pts[k][1] - pb[1]))
        if ka == kb:
            continue
        path = _shortest(g, ka, kb)
        if not path:
            continue
        score = math.hypot(pts[ka][0] - pa[0], pts[ka][1] - pa[1]) + math.hypot(pts[kb][0] - pb[0], pts[kb][1] - pb[1])
        if best is None or score < best[0]:
            best = (score, [pa] + [pts[k] for k in path] + [pb])
    return LineString(best[1]) if best else None


def _school_geom(conn, name: str):
    """DB에서 학교 이름으로 경계선(구역) 도형(미터)을 찾음"""
    norm = lambda t: re.sub(r"\s+", "", t)  # noqa: E731
    marks = ",".join("?" * len(SCHOOL_KEYS))
    rows = list(conn.execute(f"SELECT name, lat, lng, area FROM facilities WHERE type_key IN ({marks})", SCHOOL_KEYS))
    # 이름이 정확히 같은 학교를 먼저, 없으면 '서울언북초등학교'처럼 이름이 포함된 학교를 사용
    for same in (lambda n: norm(n) == norm(name), lambda n: norm(name) in norm(n)):
        for r in rows:
            if same(r["name"]):
                if r["area"]:
                    polys = [Polygon([pt_m(x, y) for x, y in rings[0]]) for rings in json.loads(r["area"])]
                    return unary_union(polys)
                return Point(*pt_m(r["lng"], r["lat"])).buffer(60)
    return None


def clip_near(lines: list, school, official_m: float):
    """학교 주변 금연거리의 길 한 개를 도형으로. 반환: (도형 또는 None, 설명)
    - 길 전체 길이가 공식 길이와 비슷하면 전체를 씀
    - 같은 이름의 길이 더 길게 이어지면, 학교에서 가까운 부분부터 공식 길이만큼만 씀
    - 학교 경계선 30m 구역이 이미 공식 길이만큼 덮고 있으면 따로 그릴 필요가 없어서 None"""
    merged = unary_union(lines)
    if merged.length <= official_m * STREET_RATIO_OK[1]:
        return merged, "전체"
    if merged.intersection(school).length >= official_m * 0.8:
        return None, "학교 30m 구역에 이미 포함"
    part = merged
    for d in range(0, 401, 1):
        part = merged.intersection(school.buffer(d))
        if part.length >= official_m:
            return part, f"학교에서 가까운 {d}m 이내"
    return part, "학교에서 400m 이내 전부"


def streets(region: str, refresh: bool) -> None:
    spec_file = DATA_DIR / f"streets_{region}.json"
    if not spec_file.exists():
        sys.exit(f"{spec_file.name} 이 없습니다")
    spec = json.loads(spec_file.read_text(encoding="utf-8"))
    names = [s["road"] for s in spec["road_segments"]] + [p["road"] for ps in spec["paired_segments"] for p in ps["parts"]]
    names += [st["name"] for sc in spec["school_streets"] for st in sc["streets"]]
    elements = fetch_roads(region, names, refresh)
    init_db()
    ok_lo, ok_hi = STREET_RATIO_OK
    rows, report = [], []

    def add(sid, label, geoms, official, measured, how, sides=1):
        ratio = measured * sides / official if official else None
        ok = bool(ratio and ok_lo <= ratio <= ok_hi)
        report.append((label, official, round(measured * sides), f"{ratio:.2f}" if ratio else "-", how, "OK" if ok else "길이 불일치(그리지 않음)"))
        if not ok:
            return
        union = unary_union(geoms)
        area = to_area_json(union, STREET_BUFFER_M)
        c = shapely.transform(union.representative_point(), to_ll)
        rows.append((f"street:{sid}", "no-smoking-street", label, c.y, c.x, area, None))

    with get_conn() as conn:
        for sg in spec["road_segments"]:
            line = road_path(_ways(elements, sg["road"]), sg["from"], sg["to"])
            if line is None:
                report.append((sg["label"], sg["official_m"], 0, "-", "경로 없음", "그리지 않음"))
                continue
            add(sg["id"], sg["label"], [line], sg["official_m"], line.length, f"{sg['from']['name']}~{sg['to']['name']}", sg["sides"])
        for pg in spec["paired_segments"]:
            lines = [road_path(_ways(elements, p["road"]), p["from"], p["to"]) for p in pg["parts"]]
            if any(ln is None for ln in lines):
                report.append((pg["label"], pg["official_total_m"], 0, "-", "경로 없음", "그리지 않음"))
                continue
            add(pg["id"], pg["label"], lines, pg["official_total_m"], sum(ln.length for ln in lines), " + ".join(p["road"] for p in pg["parts"]), pg["sides"])
        for sc in spec["school_streets"]:
            official_total = sum(st["official_m"] for st in sc["streets"])
            school = _school_geom(conn, sc["school"])
            if school is None:
                report.append((sc["label"], official_total, 0, "-", f"학교를 DB에서 못 찾음: {sc['school']}", "그리지 않음"))
                continue
            geoms, total, drawn_official, hows = [], 0.0, 0, []
            for st in sc["streets"]:
                lines = []
                for w in _ways(elements, st["name"]):
                    pts = [pt_m(p["lon"], p["lat"]) for p in w["geometry"]]
                    if len(pts) >= 2:
                        lines.append(LineString(pts))
                if not lines:
                    hows.append(f"{st['name']}: OSM에 없음")
                    continue
                part, how = clip_near(lines, school, st["official_m"])
                if part is None or part.is_empty:
                    hows.append(f"{st['name']}({how})")
                    continue
                geoms.append(part)
                total += part.length
                drawn_official += st["official_m"]  # 길이 검증은 실제로 그린 길만 공식 길이와 비교
                hows.append(f"{st['name']}({how})")
            if not geoms:
                report.append((sc["label"], official_total, 0, "-", "; ".join(hows), "학교 30m 구역에 포함(따로 그리지 않음)"))
                continue
            add(sc["id"], sc["label"], geoms, drawn_official, total, "; ".join(hows))
        where, params_bbox = in_bbox_sql(REGIONS[region]["bbox"])
        conn.execute(f"DELETE FROM facilities WHERE kakao_id LIKE 'street:%' AND {where}", params_bbox)
        conn.executemany(
            "INSERT OR REPLACE INTO facilities (kakao_id, type_key, name, lat, lng, area, r) VALUES (?,?,?,?,?,?,?)", rows
        )
    print(f"{'구간':34}{'공식m':>7}{'측정m':>7}{'비율':>6}  검증 / 방법")
    for label, official, measured, ratio, how, status in report:
        print(f"{label[:30]:34}{official:>7}{measured:>7}{ratio:>6}  {status} / {how}")
    print(f"금연거리 {len(rows)}개 저장, 제외 {len(report) - len(rows)}개 (설명 파일의 skipped 항목 {len(spec.get('skipped', []))}개는 처음부터 제외)")


def export(region: str) -> None:
    data_file, _ = region_files(region)
    where, params_bbox = in_bbox_sql(REGIONS[region]["bbox"])
    with get_conn() as conn:
        rows = []
        for r in conn.execute(
            f"SELECT kakao_id, type_key, name, lat, lng, area, r FROM facilities WHERE {where} ORDER BY type_key, kakao_id", params_bbox
        ):
            d = dict(r)
            d["area"] = json.loads(d["area"]) if d["area"] else None
            rows.append({k: v for k, v in d.items() if v is not None})
    data_file.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"[{REGIONS[region]['name']}] {len(rows)}개 시설을 {data_file.name}에 저장 ({data_file.stat().st_size // 1024}KB)")


def load(region: str | None) -> None:
    init_db()
    files = [region_files(region)[0]] if region else sorted(DATA_DIR.glob("facilities_*.json"))
    with get_conn() as conn:
        for data_file in files:
            items = json.loads(data_file.read_text(encoding="utf-8"))
            params = [
                (i["kakao_id"], i["type_key"], i["name"], i["lat"], i["lng"], json.dumps(i["area"], separators=(",", ":")) if i.get("area") else None, i.get("r"))
                for i in items
            ]
            before = conn.execute("SELECT COUNT(*) FROM facilities").fetchone()[0]
            conn.executemany(
                """INSERT INTO facilities (kakao_id, type_key, name, lat, lng, area, r) VALUES (?,?,?,?,?,?,?)
                   ON CONFLICT(kakao_id) DO UPDATE SET type_key=excluded.type_key, name=excluded.name,
                   lat=excluded.lat, lng=excluded.lng, area=excluded.area, r=excluded.r""",
                params,
            )
            after = conn.execute("SELECT COUNT(*) FROM facilities").fetchone()[0]
            print(f"{data_file.name}: {after - before}개 새로 추가, {len(items) - (after - before)}개 갱신 (전체 {after}개)")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "build":
        build(get_region(sys.argv), "--refresh" in sys.argv)
    elif cmd == "streets":
        streets(get_region(sys.argv), "--refresh" in sys.argv)
    elif cmd == "export":
        export(get_region(sys.argv))
    elif cmd == "load":
        load(get_region(sys.argv) if "--region" in sys.argv else None)
    else:
        sys.exit(__doc__)
