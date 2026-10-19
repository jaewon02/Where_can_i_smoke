"""로그인 도우미: 비밀번호 해시, 로그인 표(token), 요청 모양 (라우트는 main.py)

회원 정보는 zones.db의 users 표에, 표 목록은 서버 메모리에 보관합니다.
표 목록은 메모리에만 있으므로 서버를 다시 켜면 모두 로그아웃됩니다.
"""
import hashlib
import hmac
import re
import secrets
import threading

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, field_validator, model_validator

USER_ID_RE = re.compile(r"^[a-z0-9_]{4,20}$")
HASH_ITERATIONS = 600_000

_tokens: dict[str, dict] = {}  # 표 -> {"user_id", "nickname"}
_tokens_lock = threading.Lock()

bearer = HTTPBearer(auto_error=False)  # 표가 없을 때 403 대신 직접 401을 내려고 끔


# ---------- 비밀번호 해시 ----------
def hash_password(password: str) -> str:
    """솔트를 붙여 PBKDF2로 해시. 결과: 방식$반복수$솔트$해시"""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, HASH_ITERATIONS)
    return f"pbkdf2_sha256${HASH_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        method, iterations, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    if method != "pbkdf2_sha256":
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iterations))
    return hmac.compare_digest(digest.hex(), digest_hex)


# ---------- 표(token) ----------
def issue_token(user_id: str, nickname: str) -> str:
    token = secrets.token_urlsafe(32)
    with _tokens_lock:
        _tokens[token] = {"user_id": user_id, "nickname": nickname}
    return token


def revoke_token(token: str) -> None:
    with _tokens_lock:
        _tokens.pop(token, None)


def current_user(cred: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    """Authorization: Bearer <표> 로 로그인한 사람을 찾음 (후기 쓰기 등에서도 사용 예정)"""
    user = _tokens.get(cred.credentials) if cred else None
    if not user:
        raise HTTPException(401, "로그인이 필요합니다")
    return {**user, "token": cred.credentials}


# ---------- 요청 모양 ----------
def _lower_id(v: str) -> str:
    return v.strip().lower() if isinstance(v, str) else v


# 입력 오류(422) 문장을 한국어로 내려고, 칸이 없거나 문자열이 아니면 pydantic 기본(영어) 오류보다 먼저 막음
MISSING_MESSAGES = {
    "nickname": "닉네임을 입력해 주세요",
    "user_id": "아이디를 입력해 주세요",
    "password": "비밀번호를 입력해 주세요",
}


def _require_strings(data, fields: tuple[str, ...]):
    if isinstance(data, dict):  # JSON 객체가 아닌 본문은 pydantic 기본 오류에 맡김
        for name in fields:
            if not isinstance(data.get(name), str):
                raise ValueError(MISSING_MESSAGES[name])
    return data


class SignupIn(BaseModel):
    nickname: str
    user_id: str
    password: str

    @model_validator(mode="before")
    @classmethod
    def check_fields(cls, data):
        return _require_strings(data, ("nickname", "user_id", "password"))

    @field_validator("nickname")
    @classmethod
    def check_nickname(cls, v: str) -> str:
        v = v.strip()
        if not 1 <= len(v) <= 20:
            raise ValueError("닉네임은 앞뒤 공백을 빼고 1~20자여야 합니다")
        return v

    @field_validator("user_id")
    @classmethod
    def check_user_id(cls, v: str) -> str:
        v = _lower_id(v)
        if not USER_ID_RE.match(v):
            raise ValueError("아이디는 영문 소문자, 숫자, _ 로 4~20자여야 합니다")
        return v

    @field_validator("password")
    @classmethod
    def check_password(cls, v: str) -> str:
        if not 8 <= len(v) <= 64:
            raise ValueError("비밀번호는 8~64자여야 합니다")
        return v


class LoginIn(BaseModel):
    user_id: str
    password: str

    @model_validator(mode="before")
    @classmethod
    def check_fields(cls, data):
        return _require_strings(data, ("user_id", "password"))

    # 빈 칸 검사는 앞뒤 공백을 빼기 전 값으로 함 (공백만 넣은 아이디는 예전처럼 401)
    @field_validator("user_id")
    @classmethod
    def check_user_id(cls, v: str) -> str:
        if not v:
            raise ValueError(MISSING_MESSAGES["user_id"])
        return _lower_id(v)

    @field_validator("password")
    @classmethod
    def check_password(cls, v: str) -> str:
        if not v:
            raise ValueError(MISSING_MESSAGES["password"])
        return v
