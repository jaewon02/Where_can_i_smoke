// 지도에서 누른 지점의 장소(은행, 주민센터, 아파트, 상가, 일반 가게 등)를 카카오 API로 찾음
// 카카오 지도는 바탕 지도에 그려진 장소 이름을 눌렀다는 이벤트를 주지 않으므로 여러 방법으로 후보를 모음
// 1) 누른 지점 주변을 카테고리(은행, 카페 등 대분류)로 검색
// 2) 누른 지점 주변을 '아파트', '상가'로 키워드 검색 (대분류가 없는 장소)
// 3) 누른 지점이 건물 위면 그 건물의 도로명주소와 건물명으로 키워드 검색 -> 건물에 입점한 일반 가게까지 나옴
// 4) 버스정류장: 카카오 장소 API에 시내버스 정류장이 없어서 우리 DB(금연구역용 시설 목록)의 정류장을 씀

// 카카오 장소 카테고리 대분류 전체
const CATEGORY_CODES = [
  "MT1", "CS2", "PS3", "SC4", "AC5", "PK6", "OL7", "SW8", "BK9",
  "CT1", "AG2", "PO3", "AT4", "AD5", "FD6", "CE7", "HP8", "PM9",
];
const NEARBY_KEYWORDS = ["아파트", "상가"];
// 같은 자리에 장소가 여럿일 때(한 건물에 입점한 가게들은 좌표가 같음) 지도에 이름이 주로 표시되는 종류부터 고름
// BUS: 우리 DB의 버스정류장 (카카오 코드가 아님)
export const LABEL_PRIORITY = ["PO3", "SW8", "BUS", "BK9", "PM9", "MT1", "CS2", "OL7", "AT4", "CT1", "SC4", "HP8", "CE7", "FD6", "AD5", "PS3", "AC5", "AG2", "PK6"];
const BUILDING_PAGES = 3; // 건물 입점 장소는 한 번에 15개씩, 최대 45개까지

// 대분류가 없는 장소(아파트, 빌딩, 일반 가게)는 분류 경로의 마지막 단계를 종류로 씀
function groupOf(p) {
  if (p.category_group_name) return p.category_group_name;
  const path = (p.category_name || "").split(" > ");
  let last = path.pop() || "";
  if (last && p.place_name.startsWith(last) && path.length) last = path.pop(); // 예: '... > 세븐일레븐'
  return last;
}

export const toPlace = (p) => ({
  id: p.id,
  name: p.place_name,
  group: groupOf(p),
  groupCode: p.category_group_code || "",
  categoryPath: p.category_name || "", // 예: 금융,보험 > 금융서비스 > 은행 > KB국민은행
  roadAddress: p.road_address_name || "",
  jibunAddress: p.address_name || "",
  address: p.road_address_name || p.address_name,
  phone: p.phone || "",
  url: p.place_url || "",
  lat: Number(p.y),
  lng: Number(p.x),
});

// 카카오 장소 검색 한 번 (pages > 1 이면 다음 페이지까지 이어서 받음)
function search(kakao, run, pages = 1) {
  const { services } = kakao.maps;
  return new Promise((resolve) => {
    const all = [];
    run((data, status, pagination) => {
      if (status === services.Status.OK) all.push(...data);
      if (status === services.Status.OK && pagination?.hasNextPage && pagination.current < pages) pagination.nextPage();
      else resolve(all);
    });
  });
}

// 누른 지점이 건물 위면 그 건물 정보 (도로 위처럼 건물이 없으면 null)
function buildingAt(kakao, lat, lng) {
  const { services } = kakao.maps;
  return new Promise((resolve) =>
    new services.Geocoder().coord2Address(lng, lat, (res, status) => {
      const road = status === services.Status.OK ? res[0]?.road_address : null;
      if (!road) return resolve(null);
      const name = road.building_name || "";
      resolve({
        name,
        baseName: name.replace(/\s+\S+동$/, ""), // '역삼래미안아파트 105동' -> '역삼래미안아파트'
        roadAddress: road.address_name,
        jibunAddress: res[0].address?.address_name || "",
        zipCode: road.zone_no || "",
      });
    })
  );
}

// 누른 지점 주변 radius(m) 안의 버스정류장 (우리 서버 /api/facilities 에서 종류가 bus 인 것)
async function busStopsNear(lat, lng, radius) {
  const dLat = radius / 111320;
  const dLng = radius / (111320 * Math.cos((lat * Math.PI) / 180));
  const qs = new URLSearchParams({ south: lat - dLat, west: lng - dLng, north: lat + dLat, east: lng + dLng });
  try {
    const rows = await fetch(`/api/facilities?${qs}`).then((r) => r.json());
    return rows
      .filter((f) => f.type_key === "bus")
      .map((f) => ({
        id: `bus-${f.id}`,
        name: f.name.replace(/\s*버스정류장$/, "") || "버스정류장", // 종류에 '버스정류장'이 따로 붙으므로 이름에선 뺌
        group: "버스정류장",
        groupCode: "BUS",
        categoryPath: "",
        roadAddress: "",
        jibunAddress: "",
        address: "",
        phone: "",
        url: "",
        lat: f.lat,
        lng: f.lng,
      }));
  } catch {
    return []; // 서버가 꺼져 있어도 다른 장소는 찾을 수 있게
  }
}

// 누른 지점의 장소 후보와 건물 정보: { places: [장소...], building: {...} | null }
export async function findPlacesAt(kakao, lat, lng, radius) {
  const { services } = kakao.maps;
  const ps = new services.Places();
  const location = new kakao.maps.LatLng(lat, lng);
  const near = { location, radius: Math.round(radius), sort: services.SortBy.DISTANCE, size: 15 };

  const [byCategory, byKeyword, building, busStops] = await Promise.all([
    Promise.all(CATEGORY_CODES.map((code) => search(kakao, (cb) => ps.categorySearch(code, cb, near)))),
    Promise.all(NEARBY_KEYWORDS.map((q) => search(kakao, (cb) => ps.keywordSearch(q, cb, near)))),
    buildingAt(kakao, lat, lng),
    busStopsNear(lat, lng, radius),
  ]);
  let inBuilding = [];
  if (building) {
    const reqs = [search(kakao, (cb) => ps.keywordSearch(building.roadAddress, cb, { location, radius: 300, size: 15 }), BUILDING_PAGES)];
    if (building.baseName) reqs.push(search(kakao, (cb) => ps.keywordSearch(building.baseName, cb, { location, radius: 1000, size: 5 })));
    inBuilding = (await Promise.all(reqs)).flat();
  }

  const seen = new Set();
  const all = [...byCategory.flat(), ...byKeyword.flat(), ...inBuilding]
    .filter((p) => !seen.has(p.id) && seen.add(p.id))
    .map(toPlace);
  return { places: [...all, ...busStops], building };
}
