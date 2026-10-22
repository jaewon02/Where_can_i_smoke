// 길찾기 도착지 주변 흡연 장소 추천: 가장 가까운 흡연구역 1곳 + 후기가 많은 장소 1곳

export const RECOMMEND_RADIUS_M = 500; // 도착지에서 이 거리(직선) 안만 추천

// 두 좌표 사이 직선거리(m), 하버사인 공식
export function distanceM(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 도착지를 가운데 둔 사각형 범위 (/api/zones 조회용). 반경 원을 다 덮도록 한 변이 반경의 2배
export function boundsAround({ lat, lng }, m = RECOMMEND_RADIUS_M) {
  const dLat = m / 111320;
  const dLng = m / (111320 * Math.cos((lat * Math.PI) / 180));
  return { south: lat - dLat, north: lat + dLat, west: lng - dLng, east: lng + dLng };
}

// 반경 안 후보마다 거리를 붙임
const withinRadius = (items, dest) =>
  items
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => ({ ...p, dist: distanceM(dest, p) }))
    .filter((p) => p.dist <= RECOMMEND_RADIUS_M);

// 가장 가까운 흡연구역 (없으면 null)
// 가장 가까운 흡연 장소: 공공 흡연구역과 후기가 있는 장소를 합쳐 고름 (없으면 null)
// kind: "zone"(공공 흡연구역) | "review"(후기 장소). 거리가 같으면 공공 흡연구역을 먼저
export function nearestSpot(zones, places, dest) {
  const list = [
    ...withinRadius(
      zones.filter((z) => z.type === "smoking"),
      dest
    ).map((z) => ({ ...z, kind: "zone" })),
    ...withinRadius(places, dest).map((p) => ({ ...p, kind: "review" })),
  ];
  return list.sort((a, b) => a.dist - b.dist)[0] ?? null;
}

// 후기가 가장 많은 장소. 같으면 도착지에서 가까운 곳, 그래도 같으면 평균 별점이 높은 곳 (없으면 null)
export function mostReviewed(places, dest) {
  const list = withinRadius(places, dest).map((p) => ({ ...p, kind: "review" }));
  return list.sort((a, b) => b.count - a.count || a.dist - b.dist || (b.rating ?? 0) - (a.rating ?? 0))[0] ?? null;
}

// 두 추천이 같은 후기 장소인지 (후기 장소는 주소로 구분)
export const sameSpot = (a, b) => Boolean(a && b && a.kind === "review" && b.kind === "review" && a.address === b.address);
