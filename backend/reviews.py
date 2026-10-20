"""후기 도우미: 요청 모양, 대상 번호 검사, 작성자 찾기 (라우트는 main.py)

후기는 users.db의 reviews 표에 저장합니다. 서버는 표를 만들지 않으므로 표가 없으면 503을 냅니다.
users.db를 직접 여는 연결은 외래 키 검사가 꺼져 있을 수 있어서, 작성자가 users에 있는지는 코드에서 직접 확인합니다.
"""
import re
import sqlite3
from contextlib import contextmanager

from fastapi import HTTPException
from pydantic import BaseModel, model_validator

from db import get_conn

# 흡연구역은 zones.id, 일반 장소는 카카오 장소 번호 (버스정류장 'bus-…'처럼 숫자가 아닌 번호는 받지 않음)
TARGET_ID_RE = {
    "zone": re.compile(r"[1-9][0-9]{0,9}"),
    "place": re.compile(r"[0-9]{1,20}"),
}
CONTENT_MAX = 500
LIST_LIMIT = 100  # 목록은 최신 100개까지 (1차는 페이지 나누기 없음)

NO_TABLE = "후기 표가 없습니다. users.db에 reviews 표를 넣어 주세요"
# 목록·저장 결과에 쓰는 칸 (닉네임은 저장하지 않고 users 표에서 가져옴)
REVIEW_SELECT = (
    "SELECT r.id, u.nickname, r.rating, r.content, r.created_at "
    "FROM reviews r JOIN users u ON u.id = r.author_id"
)


def check_target(target_type, target_id) -> tuple[str, str]:
    """대상 종류와 번호 모양 검사. 틀리면 한국어 ValueError"""
    if target_type not in TARGET_ID_RE:
        raise ValueError("대상 종류는 zone 또는 place여야 합니다")
    if not isinstance(target_id, str) or not TARGET_ID_RE[target_type].fullmatch(target_id):
        raise ValueError("대상 번호가 올바르지 않습니다")
    return target_type, target_id


class ReviewIn(BaseModel):
    target_type: str
    target_id: str
    rating: int
    content: str

    # 입력 오류(422) 문장을 한국어로 내려고, pydantic 기본(영어) 검사보다 먼저 모두 확인
    @model_validator(mode="before")
    @classmethod
    def check_fields(cls, data):
        if not isinstance(data, dict):  # JSON 객체가 아닌 본문은 pydantic 기본 오류에 맡김
            return data
        check_target(data.get("target_type"), data.get("target_id"))
        rating = data.get("rating")
        # True/False도 int라서 따로 막음
        if not isinstance(rating, int) or isinstance(rating, bool) or not 1 <= rating <= 5:
            raise ValueError("별점은 1~5 사이 정수여야 합니다")
        content = data.get("content")
        content = content.strip() if isinstance(content, str) else ""
        if not 1 <= len(content) <= CONTENT_MAX:
            raise ValueError(f"후기 내용은 앞뒤 공백을 빼고 1~{CONTENT_MAX}자여야 합니다")
        return {**data, "content": content}


@contextmanager
def reviews_conn(db_name: str):
    """users.db 연결. reviews 표가 없으면 만들지 않고 503"""
    conn = get_conn(db_name)
    try:
        with conn:
            yield conn
    except sqlite3.OperationalError as e:
        if "no such table: reviews" in str(e):
            raise HTTPException(503, NO_TABLE)
        raise
    finally:
        conn.close()


def find_author(conn: sqlite3.Connection, user_id: str) -> int:
    """로그인한 사람의 users.id. 로그인 표는 있는데 계정이 지워졌으면 401"""
    row = conn.execute("SELECT id FROM users WHERE user_id = ?", (user_id,)).fetchone()
    if not row:
        raise HTTPException(401, "로그인이 필요합니다")
    return row["id"]
