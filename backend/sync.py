"""송파구 실외흡연구역 공공데이터 -> SQLite 동기화

    python sync.py                    # 공공데이터 API 호출 (.env에 두 키 필요)
    python sync.py --csv 파일.csv     # API 대신 같은 내용의 CSV 사용 (카카오 키만 필요)
    python sync.py --csv 파일.csv --schema seocho   # CSV 컬럼 형식 지정 (songpa 기본, seocho)
    python sync.py --dry-run ...      # DB에 쓰지 않고 결과만 출력

필요한 키 (backend/.env):
  DATA_API_KEY        공공데이터포털 일반 인증키 (Decoding) -- --csv 사용 시 불필요
  KAKAO_REST_API_KEY  카카오 REST API 키 (도로명주소 -> 좌표 변환용)

데이터셋: 서울특별시 송파구_실외흡연구역 위치 (data.go.kr 15090343)
컬럼: 연번, 건물명, 도로명주소, 구분(부분 개방형/완전 개방형/밀폐형), 데이터기준일자 -- 좌표가 없어 주소를 변환합니다.
"""
import csv
import json
import math
import os
import sys
import time
from collections import Counter
from pathlib import Path

import httpx
from dotenv import load_dotenv

from db import get_conn, init_db

load_dotenv()

DATA_API_URL = os.getenv(
    "DATA_API_URL",
    "https://api.odcloud.kr/api/15090343/v1/uddi:15357ecc-8285-4497-ac10-b03002763f00",
)
DATA_API_KEY = os.getenv("DATA_API_KEY", "")
KAKAO_REST_API_KEY = os.getenv("KAKAO_REST_API_KEY", "")
KAKAO_ADDRESS_URL = "https://dapi.kakao.com/v2/local/search/address.json"
PER_PAGE = 100
# 미리 변환해 둔 주소 -> 좌표 (data/geocode_*.json 모두. 이 파일이 있으면 카카오 REST 키 없이도 CSV를 가져올 수 있음)
GEOCODE_PRESETS = sorted((Path(__file__).parent / "data").glob("geocode_*.json"))
SPREAD_M = 7  # 같은 건물에 흡연구역이 여러 개일 때 마커가 겹치지 않게 펼치는 반경(미터)


def load_preset(conn) -> None:
    for preset in GEOCODE_PRESETS:
        for addr, pos in json.loads(preset.read_text(encoding="utf-8")).items():
            conn.execute("INSERT OR IGNORE INTO geocode_cache (address, lat, lng) VALUES (?,?,?)", (addr, pos["lat"], pos["lng"]))


def fetch_rows(client: httpx.Client) -> list[dict]:
    """odcloud API를 페이지 끝까지 돌며 모든 행을 가져옴"""
    rows: list[dict] = []
    page = 1
    while True:
        resp = client.get(
            DATA_API_URL,
            params={"page": page, "perPage": PER_PAGE, "serviceKey": DATA_API_KEY},
        )
        resp.raise_for_status()
        body = resp.json()
        rows.extend(body.get("data", []))
        if len(rows) >= body.get("totalCount", 0) or not body.get("data"):
            return rows
        page += 1


def read_csv(path: str) -> list[dict]:
    """CSV를 읽어 API와 같은 형태(컬럼명 -> 값)의 행 목록으로 반환. 한글 인코딩은 자동 판별"""
    for enc in ("utf-8-sig", "cp949"):
        try:
            with open(path, encoding=enc, newline="") as f:
                return [{(k or "").strip(): (v or "").strip() for k, v in row.items()} for row in csv.DictReader(f)]
        except UnicodeDecodeError:
            continue
    raise SystemExit("CSV 인코딩을 읽을 수 없습니다 (UTF-8 또는 CP949로 저장해 주세요)")


def geocode(client: httpx.Client, conn, address: str) -> tuple[float, float] | None:
    """도로명주소 -> (위도, 경도). 결과(실패 포함)는 캐시에 저장"""
    cached = conn.execute("SELECT lat, lng FROM geocode_cache WHERE address = ?", (address,)).fetchone()
    if cached:
        return (cached["lat"], cached["lng"]) if cached["lat"] is not None else None

    if not KAKAO_REST_API_KEY:
        raise SystemExit(f"좌표가 없는 주소입니다: {address} (backend/.env에 KAKAO_REST_API_KEY를 입력하세요)")
    resp = client.get(
        KAKAO_ADDRESS_URL,
        params={"query": address},
        headers={"Authorization": f"KakaoAK {KAKAO_REST_API_KEY}"},
    )
    resp.raise_for_status()
    docs = resp.json().get("documents", [])
    # 카카오 응답: x = 경도, y = 위도
    lat, lng = (float(docs[0]["y"]), float(docs[0]["x"])) if docs else (None, None)
    conn.execute("INSERT OR REPLACE INTO geocode_cache (address, lat, lng) VALUES (?,?,?)", (address, lat, lng))
    return (lat, lng) if lat is not None else None


def _short(text: str, n: int = 40) -> str:
    return text if len(text) <= n else text[: n - 1] + "…"


# 데이터셋마다 컬럼이 달라서 형식별로 (이름, 주소, 설명, 같은 시설로 묶는 기준)을 정의
SCHEMAS = {
    # 서울특별시 송파구_실외흡연구역 위치: 연번, 건물명, 도로명주소, 구분(개방형 등), 데이터기준일자
    "songpa": lambda r: {
        "name": f"{(r.get('건물명') or '').strip() or (r.get('도로명주소') or '').strip()} 흡연구역",
        "address": (r.get("도로명주소") or "").strip(),
        "note": f"{(r.get('구분') or '').strip()} 흡연구역" if (r.get("구분") or "").strip() else None,
        "group": (r.get("건물명"), r.get("도로명주소")),
    },
    # 서울특별시 서초구_흡연시설 현황: 연번, 자치구명, 해당동, 시설형태, 추가시설, 설치위치(주소 또는 설명), 규모, 설치주체, ...
    "seocho": lambda r: {
        "name": _short((r.get("설치위치") or "").strip()),
        "address": (r.get("설치위치") or "").strip(),
        "note": " · ".join(
            x for x in [(r.get("시설형태") or "").strip(), (r.get("규모") or "").strip(), (r.get("추가시설") or "").strip(),
                        f"설치주체 {(r.get('설치주체') or '').strip()}" if (r.get("설치주체") or "").strip() else ""] if x
        ),
        "group": (r.get("설치위치"),),
    },
}


def to_zone(info: dict, lat: float, lng: float, k: int = 0, n: int = 1, pk: int = 0, pn: int = 1) -> tuple:
    """같은 시설의 흡연구역이 n개면 이름에 번호(k)를 붙이고, 같은 좌표에 겹치는 구역이 pn개면 좌표(pk)를 조금씩 펼침.
    위치는 건물(주소) 단위라 정확한 흡연 지점은 아님"""
    name = info["name"]
    if n > 1:
        name += f" {k + 1}"
    if pn > 1:
        theta = 2 * math.pi * pk / pn
        lat += SPREAD_M * math.cos(theta) / 111_320
        lng += SPREAD_M * math.sin(theta) / (111_320 * math.cos(math.radians(lat)))
    return (name, "smoking", round(lat, 7), round(lng, 7), info["address"], info["note"], None)


def main() -> None:
    dry = "--dry-run" in sys.argv
    csv_path = sys.argv[sys.argv.index("--csv") + 1] if "--csv" in sys.argv else None
    schema_name = sys.argv[sys.argv.index("--schema") + 1] if "--schema" in sys.argv else "songpa"
    if schema_name not in SCHEMAS:
        raise SystemExit(f"--schema 는 {', '.join(SCHEMAS)} 중 하나여야 합니다")
    schema = SCHEMAS[schema_name]
    if not csv_path and not DATA_API_KEY:
        raise SystemExit("backend/.env에 DATA_API_KEY를 입력하세요 (또는 --csv 파일.csv 사용)")

    init_db()
    found, failed = [], []
    with httpx.Client(timeout=30) as client, get_conn() as conn:
        load_preset(conn)
        rows = read_csv(csv_path) if csv_path else fetch_rows(client)
        print(f"{'CSV' if csv_path else '공공데이터'} {len(rows)}건 읽음")
        for row in rows:
            info = schema(row)
            pos = geocode(client, conn, info["address"]) if info["address"] else None
            if not pos:
                failed.append(f"{info['name']} / {info['address']}")
                continue
            found.append((info, pos))
        # 같은 시설에 흡연구역이 여러 개인 경우 구분해서 저장
        counts = Counter(info["group"] for info, _ in found)
        addr_counts = Counter(pos for _, pos in found)  # 같은 좌표에 겹치는 구역 수
        seen, addr_seen = Counter(), Counter()
        zones = []
        for info, pos in found:
            key = info["group"]
            zones.append(to_zone(info, *pos, k=seen[key], n=counts[key], pk=addr_seen[pos], pn=addr_counts[pos]))
            seen[key] += 1
            addr_seen[pos] += 1

        if dry:
            for z in zones:
                print(z)
        else:
            conn.executemany(
                "INSERT OR IGNORE INTO zones (name, type, lat, lng, address, note, radius_m) VALUES (?,?,?,?,?,?,?)",
                zones,
            )
    print(f"{'(dry-run) ' if dry else ''}{len(zones)}건 반영, 좌표 변환 실패 {len(failed)}건")
    for f in failed:
        print("  실패:", f)


if __name__ == "__main__":
    main()
