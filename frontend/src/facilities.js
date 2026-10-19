// 카카오 장소 검색으로 법정 금연시설을 찾아 반경 원으로 표시하기 위한 정의
// 반경은 일반적인 기준을 바탕으로 한 근사치입니다 (지자체 조례에 따라 다를 수 있음).
export const FACILITY_TYPES = [
  { key: "bus", label: "버스정류장", keyword: "정류장", radius: 10, match: (p) => p.category_name?.includes("교통시설") && p.place_name.includes("정류장") && !/셔틀|고속|시외/.test(p.place_name + p.category_name) },
  { key: "subway", label: "지하철역", keyword: "지하철역", radius: 10, match: (p) => p.category_group_code === "SW8" },
  { key: "kids", label: "어린이집·유치원", keyword: "어린이집", radius: 10, match: (p) => p.category_group_code === "PS3" },
  { key: "kinder", label: "유치원", keyword: "유치원", radius: 10, match: (p) => p.category_group_code === "PS3" },
  { key: "elem", label: "초등학교", keyword: "초등학교", radius: 10, match: (p) => p.category_group_code === "SC4" },
  { key: "middle", label: "중학교", keyword: "중학교", radius: 10, match: (p) => p.category_group_code === "SC4" },
  { key: "high", label: "고등학교", keyword: "고등학교", radius: 10, match: (p) => p.category_group_code === "SC4" },
  { key: "park", label: "공원", keyword: "공원", radius: 30, match: (p) => p.category_name?.includes("공원") },
  { key: "playground", label: "어린이놀이터", keyword: "놀이터", radius: 10, match: (p) => p.place_name.includes("놀이터") },
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
