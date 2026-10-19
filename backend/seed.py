"""DB 표를 준비하고 샘플 데이터를 넣는다: python seed.py  (샘플 구역/후기를 지우고 다시 넣으려면 python seed.py --reset)

지금은 넣을 샘플 데이터가 없다 (과천 더미 데이터는 삭제함). 실제 데이터는 아래 명령으로 넣는다.
  python sync.py --csv data/songpa_smoking.csv                      # 송파구 흡연구역
  python sync.py --csv data/seocho_smoking.csv --schema seocho      # 서초구 흡연시설
  python facilities_tool.py load                                    # 금연구역 규칙 대상 시설과 금연거리
샘플을 다시 쓰고 싶으면 SAMPLES 와 REVIEWS 에 추가하면 된다.
"""
import sys

from db import get_conn, init_db

# (이름, 종류 smoking|nonsmoking, 위도, 경도, 주소, 설명, 금연 반경 m 또는 None)
SAMPLES: list[tuple] = []

# 구역 이름 -> [(닉네임, 별점, 내용, [사진 주소])]  (후기는 흡연구역에만 둔다)
REVIEWS: dict[str, list[tuple]] = {}


def main() -> None:
    init_db()  # 표가 없으면 만들고, 필요한 컬럼을 추가
    with get_conn() as conn:
        if "--reset" in sys.argv:  # 샘플 구역과 그 후기까지 지우고 다시 입력
            conn.execute("DELETE FROM zones WHERE name LIKE '%샘플%'")
        if SAMPLES:
            conn.executemany(
                "INSERT OR IGNORE INTO zones (name, type, lat, lng, address, note, radius_m) VALUES (?,?,?,?,?,?,?)",
                SAMPLES,
            )
        for name, items in REVIEWS.items():
            row = conn.execute("SELECT id FROM zones WHERE name = ?", (name,)).fetchone()
            if not row or conn.execute("SELECT 1 FROM reviews WHERE zone_id = ?", (row["id"],)).fetchone():
                continue  # 이미 후기가 있으면 건너뜀 (재실행해도 후기가 지워지지 않음)
            for author, rating, content, photo_urls in items:
                cur = conn.execute(
                    "INSERT INTO reviews (zone_id, author, rating, content) VALUES (?,?,?,?)",
                    (row["id"], author, rating, content),
                )
                conn.executemany(
                    "INSERT INTO review_photos (review_id, filename) VALUES (?,?)",
                    [(cur.lastrowid, u) for u in photo_urls],
                )
    print(f"DB 표 준비 완료. 샘플 구역 {len(SAMPLES)}개, 샘플 후기 {sum(len(v) for v in REVIEWS.values())}개 입력")


if __name__ == "__main__":
    main()
