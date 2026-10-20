// 금연구역 자동 지정 규칙
//
// 출처: 금연길라잡이 '금연구역 지정 및 확대'
// https://www.nosmokeguide.go.kr/information/policy/207  (한국건강증진개발원, 최종수정 2026-08-27)
//
// 이 파일의 역할
//   1) 화면에 보여줄 규칙 문구와 근거 (label / rule / source / basis)
//   2) 화면에 그릴지 여부 (hidden / include)
// 금연 거리(경계선에서 몇 m)와 근사 반경은 DB(facilities 표의 area, r)에 저장된 값을 씁니다.
//
// basis
//   "law"       국민건강증진법으로 정해진 금연구역
//   "ordinance" 지방자치단체 조례로 정하는 구역 (법 제9조 제6항) -- 지자체마다 다르므로 해당 조례 확인 필요

const LAW = "국민건강증진법";
const ORD = "지자체 조례 (지역별로 다름, 해당 조례 확인 필요)";
const BOUNDARY_30 = "시설 경계선으로부터 30m 이내 금연 (2023.8 확대)";
const WHOLE_SITE = "시설 전체(건물 포함 대지 전체) 금연. 주변 거리 규정은 없음";

const school = (key, label) => ({ key, label, basis: "law", source: LAW, rule: BOUNDARY_30 });

export const FACILITY_TYPES = [
  // ── 국민건강증진법 ──
  { key: "childcare", label: "어린이집", basis: "law", source: LAW, rule: BOUNDARY_30 },
  { key: "kindergarten", label: "유치원", basis: "law", source: LAW, rule: BOUNDARY_30 },
  school("elementary", "초등학교"),
  school("middle", "중학교"),
  school("high", "고등학교"),
  { key: "playground", label: "어린이놀이시설", basis: "law", source: LAW, rule: "어린이놀이기구가 설치된 놀이터 금연" },
  {
    key: "hospital", label: "의료기관", basis: "law", source: LAW, rule: WHOLE_SITE,
    // 의원·치과 등은 대부분 상가 건물 안이라 지도에는 그리지 않고, 병원급(병원/의료원/보건소)만 그림
    include: (name) => /병원|의료원|보건소|보건지소/.test(name),
  },
  { key: "library", label: "도서관", basis: "law", source: LAW, rule: WHOLE_SITE },
  { key: "office-community", label: "공공기관 청사", basis: "law", source: LAW, rule: WHOLE_SITE },
  { key: "office-district", label: "공공기관 청사", basis: "law", source: LAW, rule: WHOLE_SITE },
  // ── 지자체 조례 ──
  { key: "bus", label: "버스정류장", basis: "ordinance", source: ORD, rule: "버스 승차대(정류소)에서 10m 이내 금연" },
  // 지하철은 역 중심이 아니라 출입구 기준 (출입구는 OSM에서 가져옴). 카카오 지하철역 점은 출입구 이름을 붙이는 데만 씀
  { key: "subway", label: "지하철역", basis: "ordinance", source: ORD, rule: "", hidden: true },
  { key: "subway-exit", label: "지하철 출입구", basis: "ordinance", source: "서울시·강남구 조례 (강남구보건소 안내)", rule: "출입구에서 10m 이내 금연" },
  // 구청이 조례로 지정한 금연거리: backend/data/streets_gangnam.json 의 구간을 OSM 도로 위의 구역으로 옮긴 것 (근사 범위)
  { key: "no-smoking-street", label: "금연거리", basis: "ordinance", source: "서울특별시 강남구 금연환경 조성 및 간접흡연 피해방지 조례 제5조 (강남구보건소 금연거리 현황, 2026.7.31 기준)", rule: "구청이 지정한 금연거리 (보도 포함)", approx: true },
  { key: "park", label: "공원", basis: "ordinance", source: ORD, rule: "공원 금연 (범위는 조례별로 다름)" },
];

// type_key -> 규칙
export const RULE_BY_KEY = Object.fromEntries(FACILITY_TYPES.map((t) => [t.key, t]));
