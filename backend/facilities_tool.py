"""금연 규칙 대상 시설(facilities 테이블) 도구

    python facilities_tool.py build [--refresh]   # 시설 경계선(OSM)을 찾아 금연 구역 계산 -> DB
    python facilities_tool.py export              # DB -> data/facilities_songpa.json
    python facilities_tool.py load                # data/facilities_songpa.json -> DB

시설 위치는 카카오 장소 검색으로 송파구 전체를 구역별로 모은 것입니다 (수집 방법: tools/collect_facilities.js).
카카오는 시설의 '점' 위치만 주기 때문에, 금연 거리를 시설 경계선에서 재려고 오픈스트리트맵(OSM)의 윤곽선을 씁니다.
  - 카카오 시설 점이 OSM 윤곽선(학교, 어린이집, 병원, 도서관, 공원, 놀이터) 안에 있으면 그 윤곽선을 시설 경계로 보고,
    경계선 바깥으로 법정 거리만큼 넓힌 다각형을 금연 구역(area)으로 저장합니다.
  - 윤곽선을 못 찾으면 점 위치 + 근사 반경(r)을 씁니다.
  - 지하철은 역 중심이 아니라 OSM의 출입구 위치(10m)를 씁니다.
저장소에 JSON이 들어 있어서, 새로 받은 PC에서는 `load` 한 번이면 카카오/OSM 접속 없이 같은 데이터를 쓸 수 있습니다.

지도 데이터: © OpenStreetMap contributors (ODbL)  https://www.openstreetmap.org/copyright
"""
import json
import math
import sys
from pathlib import Path

import httpx
import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon, mapping
from shapely.ops import linemerge, polygonize, unary_union
from shapely.strtree import STRtree

from db import get_conn, init_db

DATA_FILE = Path(__file__).parent / "data" / "facilities_songpa.json"
OSM_CACHE = Path(__file__).parent / ".cache" / "osm_songpa.json"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
BBOX = (37.455, 127.07, 37.545, 127.19)  # 남, 서, 북, 동 (송파구와 주변)

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
STATION_MAX_M = 250  # 출입구와 가장 가까운 카카오 지하철역이 이 거리 안이어야 송파구 역으로 인정

# 위도/경도 <-> 미터 변환 (송파구 일대에서는 평면 근사로 충분)
LAT0, LNG0 = 37.5, 127.12
KY = 111_320.0
KX = KY * math.cos(math.radians(LAT0))
to_m = lambda a: np.column_stack(((a[:, 0] - LNG0) * KX, (a[:, 1] - LAT0) * KY))  # noqa: E731  (lng,lat -> m)
to_ll = lambda a: np.column_stack((a[:, 0] / KX + LNG0, a[:, 1] / KY + LAT0))  # noqa: E731  (m -> lng,lat)
pt_m = lambda lng, lat: ((lng - LNG0) * KX, (lat - LAT0) * KY)  # noqa: E731


def fetch_osm(refresh: bool) -> dict:
    """Overpass API에서 윤곽선/출입구를 받아 캐시 (없거나 --refresh일 때만 호출)"""
    if OSM_CACHE.exists() and not refresh:
        return json.loads(OSM_CACHE.read_text(encoding="utf-8"))
    s, w, n, e = BBOX
    box = f"({s},{w},{n},{e})"
    query = f"""[out:json][timeout:90];
(
  nwr["amenity"~"^(school|kindergarten|childcare|hospital|library)$"]{box};
  nwr["leisure"~"^(park|playground)$"]{box};
  node["railway"="subway_entrance"]{box};
);
out tags geom;"""
    resp = httpx.post(
        OVERPASS_URL,
        data={"data": query},
        headers={"User-Agent": "smoking-zone-map-dev/0.1", "Accept": "application/json"},
        timeout=150,
    )
    resp.raise_for_status()
    OSM_CACHE.parent.mkdir(exist_ok=True)
    OSM_CACHE.write_text(resp.text, encoding="utf-8")
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


def build(refresh: bool) -> None:
    init_db()
    osm = fetch_osm(refresh)
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
        conn.execute("DELETE FROM facilities WHERE kakao_id LIKE 'osm:%'")
        rows = [dict(r) for r in conn.execute("SELECT id, kakao_id, type_key, name, lat, lng FROM facilities")]
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
            updates.append((area, None if area else float(fallback_r), row["id"]))
        conn.executemany("UPDATE facilities SET area = ?, r = ? WHERE id = ?", updates)
        print(f"카카오 시설 {len(updates)}개 중 윤곽선 매칭 {matched}개 (나머지는 근사 반경)")

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
        exits = 0
        for el in elements:
            if el.get("tags", {}).get("railway") != "subway_entrance" or el["type"] != "node":
                continue
            pt = Point(*pt_m(el["lon"], el["lat"]))
            if not stations:
                break
            name, st = min(stations, key=lambda s: s[1].distance(pt))
            if st.distance(pt) > STATION_MAX_M:
                continue  # 송파구 밖 역의 출입구
            ref = el["tags"].get("ref")
            extras.append((f"osm:node/{el['id']}", "subway-exit", f"{name} {ref}번 출입구" if ref else f"{name} 출입구", el["lat"], el["lon"], None, 10.0))
            exits += 1
        conn.executemany(
            "INSERT OR REPLACE INTO facilities (kakao_id, type_key, name, lat, lng, area, r) VALUES (?,?,?,?,?,?,?)", extras
        )
        print(f"OSM에서 추가: 공원/놀이터 {len(extras) - exits}개, 지하철 출입구 {exits}개")
        total = conn.execute("SELECT COUNT(*) FROM facilities").fetchone()[0]
    print(f"완료: 시설 {total}개")


def export() -> None:
    with get_conn() as conn:
        rows = []
        for r in conn.execute("SELECT kakao_id, type_key, name, lat, lng, area, r FROM facilities ORDER BY type_key, kakao_id"):
            d = dict(r)
            d["area"] = json.loads(d["area"]) if d["area"] else None
            rows.append({k: v for k, v in d.items() if v is not None})
    DATA_FILE.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(rows)}개 시설을 {DATA_FILE.name}에 저장 ({DATA_FILE.stat().st_size // 1024}KB)")


def load() -> None:
    init_db()
    items = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    params = [
        (i["kakao_id"], i["type_key"], i["name"], i["lat"], i["lng"], json.dumps(i["area"], separators=(",", ":")) if i.get("area") else None, i.get("r"))
        for i in items
    ]
    with get_conn() as conn:
        before = conn.execute("SELECT COUNT(*) FROM facilities").fetchone()[0]
        conn.executemany(
            """INSERT INTO facilities (kakao_id, type_key, name, lat, lng, area, r) VALUES (?,?,?,?,?,?,?)
               ON CONFLICT(kakao_id) DO UPDATE SET type_key=excluded.type_key, name=excluded.name,
               lat=excluded.lat, lng=excluded.lng, area=excluded.area, r=excluded.r""",
            params,
        )
        after = conn.execute("SELECT COUNT(*) FROM facilities").fetchone()[0]
    print(f"{after - before}개 새로 추가, {len(items) - (after - before)}개 갱신 (전체 {after}개)")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "build":
        build("--refresh" in sys.argv)
    elif cmd == "export":
        export()
    elif cmd == "load":
        load()
    else:
        sys.exit(__doc__)
