// 금연구역 자동 지정 규칙: 카카오 장소 검색으로 시설을 찾아 기준에 맞는 범위를 지도에 표시합니다.
//
// 출처: 금연길라잡이 '금연구역 지정 및 확대'
// https://www.nosmokeguide.go.kr/information/policy/207  (한국건강증진개발원, 최종수정 2026-08-27)
//
// basis
//   "law"       국민건강증진법으로 정해진 금연구역
//   "ordinance" 지방자치단체 조례로 정하는 구역 (법 제9조 제6항) -- 지자체마다 다르므로 해당 조례 확인 필요
// rule    화면에 보여줄 적용 기준 문구
// radius  지도에 그리는 원의 반경(m). 카카오는 시설의 '점' 위치만 주기 때문에 시설 경계선을 알 수 없어,
//         법정 거리에 시설 규모를 더해 잡은 근사치입니다 (법정 거리와 다를 수 있음).

const LAW = "국민건강증진법";
const ORD = "지자체 조례 (지역별로 다름, 해당 조례 확인 필요)";
const BOUNDARY_30 = "시설 경계선으로부터 30m 이내 금연 (2023.8 확대)";
const WHOLE_SITE = "시설 전체(건물 포함 대지 전체) 금연";

const school = (key, keyword) => ({
  key, label: keyword, keyword, radius: 80, basis: "law", source: LAW, rule: BOUNDARY_30,
  match: (p) => p.category_group_code === "SC4" && p.place_name.includes(keyword), // 대학교(고등교육법)는 30m 규정 대상이 아니라 제외
});

export const FACILITY_TYPES = [
  // ── 국민건강증진법 ──
  { key: "childcare", label: "어린이집", keyword: "어린이집", radius: 45, basis: "law", source: LAW, rule: BOUNDARY_30, match: (p) => p.category_group_code === "PS3" },
  { key: "kindergarten", label: "유치원", keyword: "유치원", radius: 45, basis: "law", source: LAW, rule: BOUNDARY_30, match: (p) => p.category_group_code === "PS3" },
  school("elementary", "초등학교"),
  school("middle", "중학교"),
  school("high", "고등학교"),
  { key: "playground", label: "어린이놀이시설", keyword: "놀이터", radius: 20, basis: "law", source: LAW, rule: "어린이놀이기구가 설치된 놀이터 금연", match: (p) => p.place_name.includes("놀이터") },
  { key: "hospital", label: "의료기관", keyword: "병원", radius: 40, basis: "law", source: LAW, rule: WHOLE_SITE, match: (p) => p.category_group_code === "HP8" },
  { key: "library", label: "도서관", keyword: "도서관", radius: 30, basis: "law", source: LAW, rule: WHOLE_SITE, match: (p) => p.category_name?.includes("도서관") },
  { key: "office-community", label: "공공기관 청사", keyword: "주민센터", radius: 30, basis: "law", source: LAW, rule: WHOLE_SITE, match: (p) => p.category_group_code === "PO3" },
  { key: "office-district", label: "공공기관 청사", keyword: "구청", radius: 30, basis: "law", source: LAW, rule: WHOLE_SITE, match: (p) => p.category_group_code === "PO3" },
  // ── 지자체 조례 ──
  { key: "bus", label: "버스정류장", keyword: "정류장", radius: 10, basis: "ordinance", source: ORD, rule: "정류장 주변 금연 (거리는 조례별로 다름, 여기서는 10m로 표시)", match: (p) => p.category_name?.includes("교통시설") && p.place_name.includes("정류장") && !/셔틀|고속|시외/.test(p.place_name + p.category_name) },
  { key: "subway", label: "지하철역", keyword: "지하철역", radius: 10, basis: "ordinance", source: ORD, rule: "출입구 주변 금연 (거리는 조례별로 다름, 여기서는 10m로 표시)", match: (p) => p.category_group_code === "SW8" },
  { key: "park", label: "공원", keyword: "공원", radius: 30, basis: "ordinance", source: ORD, rule: "공원 금연 (범위는 조례별로 다름)", match: (p) => p.category_name?.includes("공원") },
];

// 한 키워드에 대해 최대 3페이지(45건)까지 모아서 반환
export function searchAll(kakao, keyword, bounds) {
  const places = new kakao.maps.services.Places();
  return new Promise((resolve) => {
    const all = [];
    places.keywordSearch(
      keyword,
      (data, status, pagination) => {
        if (status !== kakao.maps.services.Status.OK) return resolve(all);
        all.push(...data);
        if (pagination.hasNextPage && pagination.current < 3) pagination.nextPage();
        else resolve(all);
      },
      { bounds, size: 15 }
    );
  });
}
