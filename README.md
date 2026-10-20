# 흡연/비흡연구역 지도

흡연자가 주변 흡연구역을 찾고, 후기·사진을 남겨 다른 흡연자와 공유하는 지도 웹앱 (메가존 부트캠프 팀 프로젝트).

## 준비
1. [Kakao Developers](https://developers.kakao.com)에서 앱 생성 → JavaScript 키 발급, 플랫폼 > Web에 `http://localhost:5173` 등록
2. `frontend/.env` 생성: `VITE_KAKAO_JS_KEY=발급받은키`

## 실행
```bash
# 백엔드 (터미널 1)
cd backend
uv sync                                        # 의존성 설치 (.venv 생성)
uv run uvicorn main:app --reload --port 8001

# 프런트엔드 (터미널 2)
cd frontend
npm install
npm run dev     # http://localhost:5173
```

## 데이터베이스 (SQLite)

서버는 DB 파일이나 표를 만들지 않습니다. 미리 만들어 둔 `zones.db`, `users.db`를 `backend/` 폴더에 넣어야 하며, 파일이 없으면 해당 API에서 오류가 납니다.

사용할 파일 이름은 `backend/.env`에 적습니다 (`backend/.env.example` 참고). 두 값 모두 필요합니다.
```
ZONES_DB=zones.db
USERS_DB=users.db
```

### `zones.db` (`ZONES_DB`)
사용하는 API: 구역 목록·상세, 후기 작성, 금연 규칙 대상 시설, 길찾기 흡연모드

| 표 | 컬럼 |
|---|---|
| `zones` | `id`, `name`, `type`, `lat`, `lng`, `address`, `note`, `radius_m` |
| `facilities` | `id`, `kakao_id`, `type_key`, `name`, `lat`, `lng`, `area`, `r` |
| `geocode_cache` | `address`, `lat`, `lng` (예전 데이터 입력용. 현재 코드에서는 쓰지 않음) |

### `users.db` (`USERS_DB`)
사용하는 API: 회원가입, 로그인

| 표 | 컬럼 |
|---|---|
| `users` | `id`, `nickname`, `user_id`, `password_hash`, `created_at` |
