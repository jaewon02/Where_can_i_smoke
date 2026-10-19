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
.venv/Scripts/python seed.py                    # 샘플 데이터 (최초 1회)
.venv/Scripts/uvicorn main:app --reload --port 8001

# 프런트엔드 (터미널 2)
cd frontend
npm install
npm run dev     # http://localhost:5173
```

## 후기/사진 (흡연구역만)
- 흡연구역 마커를 누르면 오른쪽 패널에서 사진·후기를 보고 작성할 수 있습니다. (비흡연구역은 말풍선만, 후기 작성은 API에서도 차단)
- 업로드 사진은 `backend/uploads/`에 저장됩니다 (JPG/PNG/WEBP, 장당 5MB, 후기당 4장).
- 샘플 후기의 사진은 외부 더미 이미지(picsum.photos)라서 인터넷 연결이 필요합니다.
- 샘플을 지우고 다시 넣기: `python seed.py --reset` (샘플 구역의 후기도 함께 삭제됨)

## 금연구역 자동 표시
지도를 확대(레벨 5 이하)하면 `frontend/src/facilities.js`의 규칙대로 주변 시설을 카카오 장소 검색으로 찾아 금연구역을 자동으로 그립니다.
기준 출처: [금연길라잡이 - 금연구역 지정 및 확대](https://www.nosmokeguide.go.kr/information/policy/207)

| 구분 | 시설 | 적용 기준 |
|---|---|---|
| 국민건강증진법 (실선) | 어린이집·유치원·초중고 | 시설 경계선 30m 이내 |
| | 의료기관·도서관·공공기관 청사 | 시설 전체(대지 포함) |
| | 어린이놀이시설 | 놀이터 |
| 지자체 조례 (점선) | 버스정류장·지하철역·공원 | 조례별로 다름 (임시로 10m/30m 표시) |

- 카카오는 시설의 점 위치만 주기 때문에 원은 **근사 범위**입니다. 정확한 시설 경계는 아닙니다.
- 조례 항목은 지자체마다 다르므로 송파구 조례를 확인해 `facilities.js`의 `radius`/`rule`을 맞춰야 합니다.

## 송파구 실외흡연구역 데이터 연동
공공데이터포털 [송파구 실외흡연구역 위치](https://www.data.go.kr/data/15090343/fileData.do)(40건)를 받아옵니다.
이 데이터에는 좌표가 없고 도로명주소만 있어서, 카카오 REST API로 주소를 좌표로 바꿔 저장합니다.

1. `backend/.env.example`을 복사해 `backend/.env`를 만들고 두 키를 입력합니다.
   - `DATA_API_KEY`: 공공데이터포털 일반 인증키(Decoding)
   - `KAKAO_REST_API_KEY`: 카카오 REST API 키 (서버 전용, 프런트엔드에 넣지 마세요)
2. 먼저 확인만: `python sync.py --dry-run`
3. DB에 반영: `python sync.py` (다시 실행해도 중복되지 않고, 변환 결과는 캐시됩니다)
4. API 인증키 승인을 기다리는 동안에는 같은 내용의 CSV로 대신할 수 있습니다:
   `python sync.py --csv data/songpa_smoking.csv` (UTF-8/CP949 자동 인식)
   - `backend/data/`에 CSV와 미리 변환해 둔 좌표(`geocode_songpa.json`)가 들어 있어 **키 없이도** 실행됩니다.
   - 같은 건물의 흡연구역이 여러 개면 이름에 번호를 붙이고 마커를 7m 정도 펼쳐서 겹치지 않게 합니다. (위치는 건물 단위이며 실제 흡연 지점이 아닙니다)
   - `오금로 56수협`은 주소 오류라 수협중앙회 본사(오금로 62) 좌표로 추정했습니다. 확인이 필요합니다.
