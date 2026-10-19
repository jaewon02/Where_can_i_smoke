# 흡연/비흡연구역 지도

React(Vite) + FastAPI + SQLite + 카카오맵

## 준비
1. [Kakao Developers](https://developers.kakao.com)에서 앱 생성 → JavaScript 키 발급,
   플랫폼 > Web에 `http://localhost:5173` 등록
2. `frontend/.env` 생성: `VITE_KAKAO_JS_KEY=발급받은키`

## 실행
```bash
# 백엔드 (터미널 1)
cd backend
uv sync                                        # 의존성 설치 (.venv 생성)
uv run python seed.py                          # 샘플 데이터 (최초 1회)
uv run uvicorn main:app --reload --port 8001

# 프런트엔드 (터미널 2)
cd frontend
npm install
npm run dev     # http://localhost:5173
```

## 후기/사진 (흡연구역만)
- 흡연구역 마커를 누르면 오른쪽 패널에서 사진·후기를 보고 작성할 수 있습니다. (비흡연구역은 말풍선만, 후기 작성은 API에서도 차단)
- 업로드 사진은 `backend/uploads/`에 저장됩니다 (JPG/PNG/WEBP, 장당 5MB, 후기당 4장).
- 샘플 후기의 사진은 외부 더미 이미지(picsum.photos)라서 인터넷 연결이 필요합니다.
- 샘플을 지우고 다시 넣기: `uv run python seed.py --reset` (샘플 구역의 후기도 함께 삭제됨)

## 실제 API 연동
`backend/.env`에 `DATA_API_URL`, `DATA_API_KEY` 입력 후
`backend/sync.py`의 `FIELD_MAP`, `extract_items()`를 API 명세에 맞게 수정하고 `uv run python sync.py` 실행.
