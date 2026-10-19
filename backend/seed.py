"""샘플 데이터 입력: python seed.py  (샘플을 지우고 다시 넣으려면 python seed.py --reset)"""
import sys

from db import get_conn, init_db

SAMPLES = [
    # 가상의 샘플 데이터 (메가존산학연센터: 37.4175, 126.9774 주변)
    ("[샘플] 메가존 건물 옆 흡연구역", "smoking", 37.4172, 126.9780, "과천시 과천대로7길 74 인근", "건물 외부 지정 구역", None),
    ("[샘플] 메가존 정문 금연구역", "nonsmoking", 37.4177, 126.9772, "과천시 과천대로7길 74", "출입구 30m 이내 금연", 30),
    ("[샘플] 갈현동 공원 금연구역", "nonsmoking", 37.4192, 126.9790, "과천시 갈현동", "어린이 공원 금연", 80),
    ("[샘플] 과천대로 버스정류장 금연구역", "nonsmoking", 37.4160, 126.9765, "과천시 과천대로", "버스정류장 금연", 10),
    ("[샘플] 뒷골목 흡연부스", "smoking", 37.4183, 126.9758, "과천시 갈현동", "지정 흡연부스", None),
    ("[샘플] 상가 앞 흡연구역", "smoking", 37.4165, 126.9795, "과천시 갈현동", "상가 지정 구역", None),
    ("[샘플] 산책로 금연구역", "nonsmoking", 37.4198, 126.9770, "과천시 갈현동", "산책로 금연", 60),
    ("[샘플] 주차장 흡연구역", "smoking", 37.4170, 126.9755, "과천시 갈현동", "주차장 한켠 지정 구역", None),
]


def dummy(seed: str) -> str:
    """외부 더미 이미지 (같은 seed면 항상 같은 사진). 실제 서비스에서는 업로드 사진을 사용"""
    return f"https://picsum.photos/seed/{seed}/600/400"


# 구역 이름 -> [(닉네임, 별점, 내용, [사진 주소])]
REVIEWS = {
    "[샘플] 메가존 건물 옆 흡연구역": [
        ("점심러", 4, "점심시간엔 사람이 많지만 환풍이 잘 돼서 냄새가 덜해요. 재떨이도 깨끗하게 관리됩니다.", [dummy("smoke-a1"), dummy("smoke-a2")]),
        ("야근왕", 3, "밤에는 조금 어둡습니다. 조명이 더 있으면 좋겠어요.", [dummy("smoke-a3")]),
    ],
    "[샘플] 상가 앞 흡연구역": [
        ("김과천", 2, "상가 출입구와 가까워서 연기가 들어오는 날이 있어요. 위치가 아쉽습니다.", [dummy("smoke-b1")]),
    ],
    "[샘플] 뒷골목 흡연부스": [
        ("부스마니아", 5, "지붕이 있어서 비 오는 날에도 괜찮아요. 의자도 있고 쾌적합니다.", [dummy("smoke-c1"), dummy("smoke-c2"), dummy("smoke-c3")]),
        ("비오는날", 4, "비를 피할 수 있어서 좋은데 환기가 조금 아쉬워요.", []),
    ],
}  # 후기는 흡연구역에만 둡니다 (비흡연구역에는 없음)


def main() -> None:
    init_db()
    with get_conn() as conn:
        if "--reset" in sys.argv:  # 샘플 구역과 그 후기까지 지우고 다시 입력
            conn.execute("DELETE FROM zones WHERE name LIKE '%샘플%'")
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
    print(f"{len(SAMPLES)}개 샘플 구역과 샘플 후기 입력 완료")


if __name__ == "__main__":
    main()
