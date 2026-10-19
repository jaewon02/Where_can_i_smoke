import polygonClipping from "polygon-clipping";

// 금연 범위들을 하나의 금연구역으로 통일한다.
//  - 겹치는 범위는 하나의 도형으로 합쳐 바깥 테두리만 그림 (겹치는 부분의 선 제거)
//  - 합쳐진 도형 하나(= 이어진 구역)마다 배지 하나를 두기 위해, 각 시설을 자기가 속한 도형에 묶음(cluster)으로 배정
//
// 범위는 두 가지 중 하나:
//  - area: 시설 경계선 기준으로 서버가 미리 계산한 다각형 (MultiPolygon 좌표 [폴리곤[링[[lng,lat]]]])
//  - 없으면 점(lat, lng) 기준 반지름 r(m) 원

const EARTH_M_PER_DEG = 111_320;

// 중심(lat, lng)과 반경(m)으로 원을 근사하는 다각형 링 ([lng, lat] 순서, 시작점=끝점)
function circleRing(lat, lng, radiusM, steps = 32) {
  const ring = [];
  const dLat = radiusM / EARTH_M_PER_DEG;
  const dLng = radiusM / (EARTH_M_PER_DEG * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i < steps; i++) {
    const a = (2 * Math.PI * i) / steps;
    ring.push([lng + dLng * Math.sin(a), lat + dLat * Math.cos(a)]);
  }
  ring.push(ring[0]);
  return ring;
}

// 점이 링 안에 있는지 (ray casting)
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// 점이 폴리곤(바깥 링 안, 구멍 밖)에 있는지
const inPolygon = (x, y, rings) => inRing(x, y, rings[0]) && !rings.slice(1).some((h) => inRing(x, y, h));

const bboxOf = (ring) => {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
};

/**
 * areas: [{ lat, lng, r, area?, ...임의 정보, badge?: false }]  (badge:false 이면 배지 위치 후보에서 제외)
 * 반환:
 *   shape    : 합친 MultiPolygon
 *   clusters : [{ members: 같은 도형에 속한 범위들, at: {lat, lng} 배지 위치 }]  (배지를 둘 수 없으면 at = null)
 */
export function buildAreas(areas) {
  if (!areas.length) return { shape: [], clusters: [] };
  const shape = polygonClipping.union(...areas.map((a) => a.area ?? [[circleRing(a.lat, a.lng, a.r)]]));

  // 합쳐진 도형(폴리곤)마다 그 안에 있는 시설을 모음
  const boxes = shape.map((rings) => bboxOf(rings[0]));
  const members = shape.map(() => []);
  for (const a of areas) {
    let k = shape.findIndex((rings, i) => {
      const [x0, y0, x1, y1] = boxes[i];
      return a.lng >= x0 && a.lng <= x1 && a.lat >= y0 && a.lat <= y1 && inPolygon(a.lng, a.lat, rings);
    });
    if (k < 0) k = shape.findIndex((_, i) => a.lng >= boxes[i][0] && a.lng <= boxes[i][2] && a.lat >= boxes[i][1] && a.lat <= boxes[i][3]);
    if (k >= 0) members[k].push(a);
  }

  const clusters = members
    .filter((m) => m.length)
    .map((group) => {
      // 배지는 묶음의 평균 위치에서 가장 가까운 시설 위치에 둠 (합친 도형이 오목해도 항상 구역 안에 놓이도록)
      const cand = group.filter((m) => m.badge !== false);
      if (!cand.length) return { members: group, at: null };
      const mean = {
        lat: cand.reduce((s, m) => s + m.lat, 0) / cand.length,
        lng: cand.reduce((s, m) => s + m.lng, 0) / cand.length,
      };
      const best = cand.reduce(
        (b, m) => {
          const d = (m.lat - mean.lat) ** 2 + (m.lng - mean.lng) ** 2;
          return d < b.d ? { m, d } : b;
        },
        { m: cand[0], d: Infinity }
      ).m;
      return { members: group, at: { lat: best.lat, lng: best.lng } };
    });
  return { shape, clusters };
}
