# AGENTS.md

흡연자가 주변 흡연구역을 찾고, 후기·사진을 남겨 다른 흡연자와 공유하는 지도 웹앱 (메가존 부트캠프 팀 프로젝트).

## 기술 스택
- 프론트엔드: React 18 + Vite, **JavaScript(.jsx)** — TypeScript로 바꾸지 않는다
- 스타일링/UI: **Tailwind CSS** + **shadcn/ui** — `frontend/`에 설치되어 있지 않으면 설치하고 쓴다 (shadcn은 `components.json`에 `"tsx": false`로 JS 컴포넌트 생성)
- 백엔드: FastAPI + Python, 패키지 관리는 **uv** (`pyproject.toml` + `uv.lock` 커밋)
- DB: **SQLite**
- 지도: 카카오맵 JavaScript API
- 배포: 없음. 로컬 시연만 목표로 한다

## 구조
```
backend/
  main.py      # FastAPI 앱, 모든 /api 라우트
  db.py        # get_conn(), init_db() — 스키마 정의와 마이그레이션(ALTER)
  seed.py      # 초기 데이터 (data/ 파일 → DB: 시설·흡연구역·금연거리, 예전 과천 샘플 정리)
  sync.py      # 공공데이터 API → zones 동기화
  uploads/     # 후기 사진 저장소 (git 제외)
frontend/src/
  App.jsx, ZonePanel.jsx, facilities.js, useKakaoMap.js
```

## 실행
```bash
# 백엔드 (포트 8001)
cd backend
uv sync
uv run python seed.py                  # 초기 데이터 (최초 1회)
uv run uvicorn main:app --reload --port 8001

# 프런트엔드 (포트 5173, /api 는 8001로 프록시)
cd frontend
npm install
npm run dev
```

## 협업 규칙
- 브랜치: `main`에서 `feat/…`, `fix/…`, `docs/…`, `chore/…` 브랜치를 따서 작업 → PR → 리뷰 후 머지
- 커밋 메시지: 한글 자유 서술 (예: `후기 삭제 API 추가`)
- 에이전트 응답, 코드 주석, 문서 모두 **한국어**

## 사용자 확인 없이 하지 말 것
- `main` 브랜치에 직접 커밋·푸시
- DB 스키마(테이블·컬럼) 변경
- `.env` 파일, API 키(카카오 키, 공공데이터 키) 수정 또는 커밋 — 새 환경변수는 `.env.example`에만 추가한다
- 이 문서에 명시되지 않은 작업(예: 새 의존성 추가, 폴더 구조 변경, 기술 스택 교체) — 진행하기 전에 무엇을 왜 하려는지 사람에게 먼저 설명하고 확인받는다
