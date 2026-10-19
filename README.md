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

## 금연구역 자동 표시
`frontend/src/facilities.js`의 규칙대로 송파구·강남구의 금연구역을 지도에 자동으로 그립니다. 축소/확대와 상관없이 화면에 보이는 영역 전체가 대상이고,
겹치는 범위는 하나의 구역으로 합쳐져 바깥 테두리만 그려집니다. 구역마다 배지(눌러서 시설 목록과 적용 기준 확인)는 많이 확대했을 때(레벨 2 이하)만 표시합니다.
기준 출처: [금연길라잡이 - 금연구역 지정 및 확대](https://www.nosmokeguide.go.kr/information/policy/207)

| 구분 | 시설 | 적용 기준 |
|---|---|---|
| 국민건강증진법 | 어린이집·유치원·초중고 | **시설 경계선**에서 30m 이내 |
| | 의료기관(병원급)·도서관·공공기관 청사 | 시설 전체(건물 포함 대지). 주변 거리 규정은 없음 |
| | 어린이놀이시설 | 놀이터 |
| 지자체 조례 | 지하철 출입구 | **출입구에서 10m** (서울시·강남구 조례, [강남구보건소 안내](https://health.gangnam.go.kr/web/business/promotion/clinic/sub02.do) 2026.7.31 기준) |
| | 버스정류장 | **승차대에서 10m** (팀에서 안내받은 기준. 서울시 조례는 "버스정류소 및 택시 승차대"를 금연구역으로 지정하지만 원문 해설에서 거리는 확인하지 못함) |
| | 공원 | 조례별로 다름 (범위는 OSM 공원 윤곽선) |

**경계선 기준 계산**: 카카오는 시설의 점 위치만 주기 때문에, 오픈스트리트맵(OSM)의 시설 윤곽선을 찾아 경계선으로 씁니다.
- 카카오 시설 점이 OSM 윤곽선 안에 있으면 그 윤곽선에서 법정 거리만큼 넓힌 다각형을 구역으로 저장합니다. (학교는 송파구 91곳 중 87곳, 강남구 132곳 중 130곳이 매칭)
- 윤곽선이 없는 시설(주로 어린이집·유치원)은 위치 + 근사 반경으로 그리고, 말풍선에 "범위 추정"이라고 표시합니다.
- 지하철은 역 중심이 아니라 OSM의 **출입구** 위치(송파구 129곳, 강남구 290곳)에서 10m를 씁니다.
- 의원·치과 같은 작은 의료기관은 대부분 상가 건물 안이라 지도에는 그리지 않습니다. (DB에는 보관)
- 버스정류장은 카카오에 거의 없어서 OSM의 버스정류장(`highway=bus_stop`)을 씁니다. 방향별 승강장이 따로 찍혀 있어 강남구 공식 지정 수(544곳)보다 많이 표시됩니다. 택시 승차대는 아직 넣지 않았습니다.
- 조례 항목은 지자체마다 다르므로 해당 구 조례를 확인해 `facilities.js`와 `backend/facilities_tool.py`의 `RULES`를 맞춰야 합니다. 학교보호구역(출입문 50m), 도시공원 등 강남구 조례 항목 중 아직 반영하지 못한 것이 있습니다.

**데이터 준비** (처음 받은 PC에서는 이것만 하면 됩니다. 카카오/OSM 접속 불필요)
```bash
cd backend
uv run python facilities_tool.py load     # data/facilities_*.json -> DB (송파구·강남구 시설, 경계선 구역 포함)
```
**데이터를 새로 만들려면** (지역: `songpa`, `gangnam`. 새 지역은 `facilities_tool.py`의 `REGIONS`에 영역만 추가)
1. 시설 위치 수집: `tools/collect_facilities.js` 상단 설명대로 브라우저에서 실행 (카카오 장소 검색, 구를 격자로 나눠 빠짐없이 수집)
2. 경계선 계산: `uv run python facilities_tool.py build --region gangnam [--refresh]` (OSM Overpass에서 윤곽선/출입구를 받아 구역 계산)
3. 저장소용 파일 갱신: `uv run python facilities_tool.py export --region gangnam`

지도 윤곽선 데이터: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL). 화면 오른쪽 아래에 출처를 표시합니다.

**지도 색**: 흡연자 기준으로 **흡연구역은 초록(피워도 되는 곳), 금연구역은 빨강(피우면 안 되는 곳)** 입니다. (`App.jsx`의 `COLORS`와 `styles.css`의 `--smoking`/`--nonsmoking`)

## 송파구 실외흡연구역 데이터 연동
공공데이터포털 [송파구 실외흡연구역 위치](https://www.data.go.kr/data/15090343/fileData.do)(40건)를 받아옵니다.
이 데이터에는 좌표가 없고 도로명주소만 있어서, 카카오 REST API로 주소를 좌표로 바꿔 저장합니다.

1. `backend/.env.example`을 복사해 `backend/.env`를 만들고 두 키를 입력합니다.
   - `DATA_API_KEY`: 공공데이터포털 일반 인증키(Decoding)
   - `KAKAO_REST_API_KEY`: 카카오 REST API 키 (서버 전용, 프런트엔드에 넣지 마세요)
2. 먼저 확인만: `uv run python sync.py --dry-run`
3. DB에 반영: `uv run python sync.py` (다시 실행해도 중복되지 않고, 변환 결과는 캐시됩니다)
4. API 인증키 승인을 기다리는 동안에는 같은 내용의 CSV로 대신할 수 있습니다:
   `uv run python sync.py --csv data/songpa_smoking.csv` (UTF-8/CP949 자동 인식)
   - `backend/data/`에 CSV와 미리 변환해 둔 좌표(`geocode_songpa.json`)가 들어 있어 **키 없이도** 실행됩니다.
   - 같은 건물의 흡연구역이 여러 개면 이름에 번호를 붙이고 마커를 7m 정도 펼쳐서 겹치지 않게 합니다. (위치는 건물 단위이며 실제 흡연 지점이 아닙니다)
   - `오금로 56수협`은 주소 오류라 수협중앙회 본사(오금로 62) 좌표로 추정했습니다. 확인이 필요합니다.

## 서초구 흡연시설 데이터 (강남구 데이터가 없어 시연용으로 추가)
강남구는 흡연구역 위치를 공개하지 않아, 인접한 서초구의 [서울특별시 서초구_흡연시설 현황](https://www.data.go.kr/data/15074379/fileData.do)(48건, 2026-03-18 기준, 공공저작물 출처표시)을 넣었습니다.
- `backend/data/seocho_smoking.csv`: 원본 컬럼 그대로. 위치 컬럼(`설치위치`)이 주소 또는 설명 문장이라, 도로명 주소, 지번, 역 출구, 건물 이름 순서로 카카오 검색을 시도해 좌표를 구했습니다 (`backend/data/geocode_seocho.json`).
- 한 건(`남부순환로 2636 … 오선채 좌측골목`)은 주소 검색이 안 돼서 설명에 나온 `오선채`(양재동 1-23) 위치로 추정했습니다. 나머지는 도로명/지번 주소 또는 건물·출구 이름으로 찾은 위치입니다.
- 실행: `uv run python sync.py --csv data/seocho_smoking.csv --schema seocho`
- 강남구 흡연구역 데이터를 받으면 같은 방식으로 `--schema`를 추가하면 됩니다.
