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

### `zones.db`
사용 파일: `backend/db.py`, `backend/main.py`, `backend/seed.py`, `backend/sync.py`, `backend/facilities_tool.py`

| 표 | 컬럼 |
|---|---|
| `zones` | `id`, `name`, `type`, `lat`, `lng`, `address`, `note`, `radius_m` |
| `reviews` | `id`, `zone_id`, `author`, `rating`, `content`, `created_at` |
| `review_photos` | `id`, `review_id`, `filename` |
| `facilities` | `id`, `kakao_id`, `type_key`, `name`, `lat`, `lng`, `area`, `r` |
| `geocode_cache` | `address`, `lat`, `lng` |

### `users.db`
사용 파일: `backend/db.py`, `backend/main.py`

| 표 | 컬럼 |
|---|---|
| `users` | `id`, `nickname`, `user_id`, `password_hash`, `created_at` |
