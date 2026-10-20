# AGENTS.md

코드 생성 및 문서 작성시 다음 수칙/사항들을 준수할 것 

## 주의 사항
- `README.md` 수정 절대 금지
- **AI 에이전트는 `README.md`를 절대로 수정·덮어쓰기·삭제·이동하지 않는다.**
- 기능 추가, 리팩터링, 문서 정리 등 **어떤 작업을 하더라도** README를 "같이 업데이트"하지 않는다.
- README 내용이 코드와 어긋나 보이면 고치지 말고, 응답에서 사람에게 **알리기만** 한다.
- 유일한 예외: 사람이 그 요청에서 **`README.md` 수정을 명시적으로 직접 지시한 경우**. 추측·암시·"문서 전반 정리해줘" 같은 요청은 예외가 아니다.

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
  data/

frontend/
  src/
```

## 실행
```bash
# 백엔드 (포트 8001)
cd backend
uv sync
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
