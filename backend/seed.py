"""초기 데이터 한 번에 넣기: uv run python seed.py  (다시 실행해도 중복되지 않음)

- 예전 버전의 과천 샘플(더미) 구역과 그 후기가 DB에 남아 있으면 지움
- 저장소의 backend/data/ 파일로 실제 데이터를 넣음
  · 금연 규칙 대상 시설 (송파구·강남구, 경계선 기준 금연 구역 포함)
  · 송파구 실외흡연구역, 서초구 흡연시설
  · 강남구 금연거리 (OSM 도로 정보를 받아오므로 인터넷 연결 필요)
- 카카오/공공데이터 키 없이 실행됨 (좌표는 data/geocode_*.json 에 미리 변환되어 있음)
"""
import subprocess
import sys
from pathlib import Path

from db import get_conn, init_db

HERE = Path(__file__).parent

STEPS = [
    ("금연 규칙 대상 시설 (송파구·강남구)", ["facilities_tool.py", "load"]),
    ("송파구 실외흡연구역", ["sync.py", "--csv", "data/songpa_smoking.csv"]),
    ("서초구 흡연시설", ["sync.py", "--csv", "data/seocho_smoking.csv", "--schema", "seocho"]),
    ("강남구 금연거리", ["facilities_tool.py", "streets", "--region", "gangnam"]),
]


def main() -> None:
    init_db()
    with get_conn() as conn:  # foreign_keys=ON 이라 샘플 구역의 후기·후기 사진도 함께 지워짐
        removed = conn.execute("DELETE FROM zones WHERE name LIKE '[샘플]%'").rowcount
    if removed:
        print(f"예전 과천 샘플 구역 {removed}개(후기 포함)를 지웠습니다", flush=True)

    failed = []
    for label, args in STEPS:
        print(f"\n== {label}", flush=True)  # 아래 명령 출력보다 먼저 보이도록
        if subprocess.run([sys.executable, *args], cwd=HERE).returncode != 0:
            failed.append(label)

    with get_conn() as conn:
        smoking = conn.execute("SELECT COUNT(*) FROM zones WHERE type = 'smoking'").fetchone()[0]
        facilities = conn.execute("SELECT COUNT(*) FROM facilities").fetchone()[0]
    print(f"\n완료: 흡연구역 {smoking}곳, 금연 규칙 대상 시설·금연거리 {facilities}곳")
    if failed:
        print("실패한 단계: " + ", ".join(failed) + " (위 메시지를 확인하고 해당 명령만 다시 실행하세요)")
        sys.exit(1)


if __name__ == "__main__":
    main()
