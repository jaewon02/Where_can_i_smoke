"""외부 공공 API -> SQLite 동기화: python sync.py

주의: API마다 응답 구조/필드명이 다르므로 FIELD_MAP과 extract_items()를
사용하는 API 명세에 맞게 수정해야 합니다.
"""
import os

import httpx
from dotenv import load_dotenv

from db import get_conn, init_db

load_dotenv()

API_URL = os.getenv("DATA_API_URL", "")
API_KEY = os.getenv("DATA_API_KEY", "")

# 우리 컬럼 -> API 응답 필드명 (API 명세에 맞게 수정)
FIELD_MAP = {
    "name": "name",
    "lat": "latitude",
    "lng": "longitude",
    "address": "address",
    "note": "note",
}
ZONE_TYPE = "smoking"  # 이 API가 흡연구역이면 smoking, 금연구역이면 nonsmoking


def extract_items(payload: dict) -> list[dict]:
    # 예: 응답이 {"response": {"body": {"items": [...]}}} 형태라면 아래처럼 수정
    return payload.get("items", [])


def main() -> None:
    if not API_URL:
        raise SystemExit("DATA_API_URL이 비어 있습니다 (.env 확인)")
    init_db()
    resp = httpx.get(API_URL, params={"serviceKey": API_KEY, "type": "json"}, timeout=30)
    resp.raise_for_status()
    rows = []
    for it in extract_items(resp.json()):
        try:
            rows.append(
                (
                    it[FIELD_MAP["name"]],
                    ZONE_TYPE,
                    float(it[FIELD_MAP["lat"]]),
                    float(it[FIELD_MAP["lng"]]),
                    it.get(FIELD_MAP["address"]),
                    it.get(FIELD_MAP["note"]),
                    None,  # API에 반경 정보가 있으면 여기에 매핑
                )
            )
        except (KeyError, ValueError, TypeError):
            continue  # 좌표 없는 항목은 건너뜀
    with get_conn() as conn:
        conn.executemany(
            "INSERT OR IGNORE INTO zones (name, type, lat, lng, address, note, radius_m) VALUES (?,?,?,?,?,?,?)",
            rows,
        )
    print(f"{len(rows)}개 동기화 완료")


if __name__ == "__main__":
    main()
