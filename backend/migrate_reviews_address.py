"""reviews 표에 address(도로명주소) 칸과 'building' 대상 종류를 넣는 일회성 변경 스크립트

같은 건물(같은 도로명주소)의 후기를 한데 모아 보여주려고, 후기마다 장소 번호와 주소를 같이 저장합니다.
SQLite는 CHECK 조건을 ALTER로 바꿀 수 없어서 새 표를 만들어 옮긴 뒤 이름을 바꿉니다.
실행 전에 같은 폴더에 users.backup-날짜시각.db 로 백업을 만들고, 이미 바뀐 DB면 아무것도 하지 않습니다.

    cd backend
    uv run python migrate_reviews_address.py
"""

import os
import sqlite3
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()
DB_PATH = Path(__file__).parent / os.getenv("USERS_DB", "users.db")

NEW_TABLE = """
CREATE TABLE reviews_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_type TEXT NOT NULL CHECK (target_type IN ('zone', 'place', 'building')),
    target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 20),
    address TEXT CHECK (address IS NULL OR length(address) BETWEEN 1 AND 200),
    author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 500),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
)
"""


def main():
    if not DB_PATH.exists():
        raise SystemExit(f"{DB_PATH} 파일이 없습니다")
    conn = sqlite3.connect(DB_PATH)
    try:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(reviews)")]
        if not cols:
            raise SystemExit("reviews 표가 없습니다")
        if "address" in cols:
            print("이미 address 칸이 있습니다. 바꿀 것이 없습니다")
            return

        backup = DB_PATH.with_name(
            f"{DB_PATH.stem}.backup-{datetime.now():%Y%m%d-%H%M%S}.db"
        )
        with sqlite3.connect(backup) as dst:
            conn.backup(dst)
        print(f"백업: {backup.name}")

        # 한 트랜잭션으로 묶어서 중간에 실패하면 원래 표가 그대로 남음
        with conn:
            conn.execute(NEW_TABLE)
            conn.execute(
                "INSERT INTO reviews_new (id, target_type, target_id, author_id, rating, content, created_at) "
                "SELECT id, target_type, target_id, author_id, rating, content, created_at FROM reviews"
            )
            conn.execute("DROP TABLE reviews")
            conn.execute("ALTER TABLE reviews_new RENAME TO reviews")
            conn.execute(
                "CREATE INDEX idx_reviews_target ON reviews (target_type, target_id, id)"
            )
            conn.execute(
                "CREATE INDEX idx_reviews_address ON reviews (target_type, address, id)"
            )
        count = conn.execute("SELECT count(*) FROM reviews").fetchone()[0]
        print(f"완료: reviews 표에 address 칸 추가 (옮긴 후기 {count}건)")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
