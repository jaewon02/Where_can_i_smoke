// 내 위치가 금연구역 안인지 판단. 화면에는 들어가 있는 구역의 범위만 빨갛게 그림
//
// rows: /api/facilities 가 주는 시설 목록 [{ type_key, name, lat, lng, area?, r? }]
//   area: 시설 경계선 기준 금연 구역 (MultiPolygon [폴리곤[링[[lng,lat]]]]), 없으면 점(lat,lng) 기준 반지름 r(m) 원
import { RULE_BY_KEY } from "./facilities.js";

const M_PER_DEG = 111_320;

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

// 점이 폴리곤 안(바깥 링 안, 구멍 밖)에 있는지
const inPolygon = (x, y, rings) => inRing(x, y, rings[0]) && !rings.slice(1).some((hole) => inRing(x, y, hole));

function contains(f, lat, lng) {
  if (f.area) return f.area.some((poly) => inPolygon(lng, lat, poly));
  const dy = (lat - f.lat) * M_PER_DEG;
  const dx = (lng - f.lng) * M_PER_DEG * Math.cos((lat * Math.PI) / 180);
  return Math.hypot(dx, dy) <= (f.r ?? 0);
}

// 지도에 금연 범위로 그릴 시설만 대상 (지하철역 점, 의원급 의료기관 등은 제외. 그리는 규칙과 같음)
const counts = (f) => {
  const t = RULE_BY_KEY[f.type_key];
  return t && !t.hidden && !(t.include && !t.include(f.name));
};

// 내 위치(lat, lng)가 들어 있는 금연구역 목록: [{ name, label, lat, lng, r, area }] (범위를 그릴 수 있게 시설 정보도 둠)
export function findZonesAt(rows, lat, lng) {
  return rows.filter((f) => counts(f) && contains(f, lat, lng)).map((f) => ({ ...f, label: RULE_BY_KEY[f.type_key].label }));
}
