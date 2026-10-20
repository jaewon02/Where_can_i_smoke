import sqlite3
from pathlib import Path

DB_DIR = Path(__file__).parent


def get_conn(db_name: str) -> sqlite3.Connection:
    """backend/ 안의 DB 파일(예: "zones.db", "users.db")에 연결"""
    # 경로가 섞인 이름("../x.db" 등)은 거부해서 backend/ 밖의 파일을 열지 못하게 함
    if Path(db_name).name != db_name or not db_name.endswith(".db"):
        raise ValueError(f"DB 파일 이름이 올바르지 않습니다: {db_name}")
    # mode=rw: 미리 만들어 둔 DB 파일이 없으면 빈 파일을 만들지 않고 바로 오류를 냄
    conn = sqlite3.connect(f"{(DB_DIR / db_name).as_uri()}?mode=rw", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn
