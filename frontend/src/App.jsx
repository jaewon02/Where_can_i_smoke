import { useEffect, useRef, useState } from "react";
import { useKakao } from "./useKakaoMap.js";
import { RULE_BY_KEY } from "./facilities.js";
import ZonePanel from "./ZonePanel.jsx";
import { buildAreas } from "./areas.js";

// 흡연자 기준 색: 피워도 되는 곳(흡연구역)은 초록, 피우면 안 되는 곳(금연구역)은 빨강. styles.css 의 --smoking / --nonsmoking 과 같은 값
const COLORS = { smoking: "#1f9d55", nonsmoking: "#e5484d" };
// 카카오 지도 레벨은 숫자가 작을수록 많이 확대한 것. 화면이 복잡해지지 않게 확대했을 때만 금연구역을 보여줌
const AREA_MAX_LEVEL = 3; // 이 레벨 이하로 확대했을 때만 금연구역 범위 표시
const BADGE_MAX_LEVEL = 2; // 이 레벨 이하로 확대했을 때만 금연구역 배지 표시

// 시설 범위의 큰 쪽 길이(m): 경계선 다각형이면 그 바깥 사각형, 아니면 반경 원의 지름
function extentM(f) {
  if (!f.area) return 2 * f.r;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of f.area)
    for (const [x, y] of poly[0]) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  return Math.max((x1 - x0) * 111320 * Math.cos((y0 * Math.PI) / 180), (y1 - y0) * 111320);
}

const svgUri = (svg) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);

// 담배 그림 (흰색). 필터부분은 반투명
const CIGARETTE = `
  <rect x="9" y="21" width="12" height="4" rx="1" fill="#fff"/>
  <rect x="21" y="21" width="5" height="4" rx="1" fill="#fff" opacity=".5"/>
  <path d="M28 21v4M24.5 17c0-1.8 2-1.8 2-3.6M19.5 17c0-1.8 2-1.8 2-3.6" stroke="#fff" stroke-width="1.6" stroke-linecap="round" fill="none"/>`;

// 핀 모양 마커: 흡연구역은 담배, 비흡연구역은 금연 표시(원 + 사선)
function pinImage(kakao, type) {
  const color = COLORS[type];
  const icon =
    type === "smoking"
      ? CIGARETTE
      : `<g transform="translate(20 20) scale(.62) translate(-20 -20)">${CIGARETTE}</g>
         <circle cx="20" cy="20" r="11" fill="none" stroke="#fff" stroke-width="2.4"/>
         <path d="M12.5 27.5l15-15" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="46" viewBox="0 0 40 54">
    <defs><filter id="s" x="-30%" y="-20%" width="160%" height="150%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity=".3"/></filter></defs>
    <path filter="url(#s)" d="M20 2C10 2 2 10 2 20c0 13 18 31 18 31s18-18 18-31C38 10 30 2 20 2z" fill="${color}" stroke="#fff" stroke-width="2.5"/>
    ${icon}</svg>`;
  return new kakao.maps.MarkerImage(svgUri(svg), new kakao.maps.Size(34, 46), { offset: new kakao.maps.Point(17, 44) });
}

// 주변 금연시설 중심에 얹는 작은 금연 배지
function badgeImage(kakao) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
    <circle cx="10" cy="10" r="8.5" fill="#fff" stroke="${COLORS.nonsmoking}" stroke-width="1.6"/>
    <rect x="4.8" y="9" width="7" height="2.2" rx=".6" fill="${COLORS.nonsmoking}"/>
    <rect x="11.8" y="9" width="3.4" height="2.2" rx=".6" fill="${COLORS.nonsmoking}" opacity=".5"/>
    <path d="M5 15L15 5" stroke="${COLORS.nonsmoking}" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  return new kakao.maps.MarkerImage(svgUri(svg), new kakao.maps.Size(20, 20), { offset: new kakao.maps.Point(10, 10) });
}

// 담배 아이콘 (slash=true면 금연 표시: 담배에 X)
function CigaretteIcon({ slash = false }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="15" width="12" height="4" rx="1" />
      <rect x="14" y="15" width="5" height="4" rx="1" fill="currentColor" stroke="none" opacity=".45" />
      <path d="M21 15v4M18.5 11c0-1.8 2-1.8 2-3.6M14.5 11c0-1.8 2-1.8 2-3.6" />
      {slash && <path d="M3.5 3.5l17 17" strokeWidth="2.4" />}
    </svg>
  );
}

export default function App() {
  const { kakao, error } = useKakao();
  const [menuOpen, setMenuOpen] = useState(true);
  const [selectedId, setSelectedId] = useState(null); // 오른쪽 상세 패널에 보여줄 구역
  const [showSmoking, setShowSmoking] = useState(true);
  const [showNon, setShowNon] = useState(true); // 비흡연구역 + 주변 금연시설
  const [zoomLevel, setZoomLevel] = useState(6); // 지금 지도 확대 레벨 (금연구역을 보여줄지 안내하는 데 사용)
  const flagsRef = useRef({});
  flagsRef.current = { showSmoking, showNon };
  const zonesRef = useRef([]);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const zoneAreasRef = useRef([]); // 직접 등록한 비흡연구역의 범위
  const facilityAreasRef = useRef([]); // 규칙으로 찾은 금연시설의 범위
  const facilityBadgesRef = useRef([]);
  const areaPolysRef = useRef([]);
  const areasKeyRef = useRef("");
  const facilityReqRef = useRef(0);
  const infoRef = useRef(null);

  // 구역 배지를 눌렀을 때 보여줄 말풍선: 구역에 속한 시설 목록과 적용 기준
  const openAreaInfo = (members, marker) => {
    const facilities = members.filter((m) => m.badge !== false);
    const shown = facilities.slice(0, 6);
    const el = document.createElement("div");
    el.className = "info";
    const title = document.createElement("b");
    // 이름에 종류가 이미 들어 있으면(예: '강남대로 동측 금연거리') 종류를 또 붙이지 않음
    const kindOf = (m) => (m.name.includes(m.label) ? m.name : `${m.name} · ${m.label} 금연구역`);
    title.textContent = facilities.length > 1 ? `금연구역 (시설 ${facilities.length}곳)` : kindOf(facilities[0]);
    el.append(title);
    if (facilities.length > 1) {
      const ul = document.createElement("ul");
      ul.className = "area-list";
      shown.forEach((m) => {
        const li = document.createElement("li");
        li.textContent = `${m.name}${m.name.includes(m.label) ? "" : ` (${m.label})`}${m.exact ? "" : " · 범위 추정"}`;
        ul.append(li);
      });
      if (facilities.length > shown.length) {
        const li = document.createElement("li");
        li.textContent = `외 ${facilities.length - shown.length}곳`;
        ul.append(li);
      }
      el.append(ul);
    }
    // 적용 기준은 종류별로 한 번씩만
    const rules = [...new Map(facilities.map((m) => [m.rule + m.source, m])).values()];
    rules.forEach((m) => {
      const small = document.createElement("small");
      small.textContent = `${facilities.length > 1 ? `${m.label}: ` : ""}${m.rule} · 근거: ${m.source}`;
      el.append(document.createElement("br"), small);
    });
    const note = document.createElement("small");
    note.className = "muted";
    const exactCount = facilities.filter((m) => m.exact).length;
    note.textContent =
      exactCount === facilities.length
        ? "※ 시설 경계선(OpenStreetMap)을 기준으로 계산한 범위입니다"
        : exactCount === 0
          ? "※ 시설의 정확한 경계를 몰라 위치 기준으로 추정한 범위입니다"
          : "※ 일부 시설은 경계선 대신 위치 기준으로 추정한 범위입니다";
    el.append(document.createElement("br"), note);
    setSelectedId(null);
    infoRef.current.setContent(el);
    infoRef.current.open(mapRef.current, marker);
  };

  // 모든 금연 범위를 하나의 구역으로 합쳐 그림: 겹치는 부분의 선은 없애고, 구역마다 배지는 하나만 둠
  const drawAreas = () => {
    const map = mapRef.current;
    const showAreas = map.getLevel() <= AREA_MAX_LEVEL; // 넓게 볼 때는 금연구역을 그리지 않음
    const areas = showAreas ? [...zoneAreasRef.current, ...facilityAreasRef.current] : [];
    // 지도를 움직여도 범위가 그대로면 다시 그리지 않음 (열려 있는 말풍선이 닫히지 않도록)
    // 배지는 많이 확대했을 때(레벨 2 이하)만 표시. 그보다 넓게 볼 때는 범위만 보여줌 (배지가 너무 빽빽해서)
    const showBadges = map.getLevel() <= BADGE_MAX_LEVEL;
    const key = JSON.stringify([showBadges, areas.map((a) => [a.lat, a.lng, a.name])]);
    if (key === areasKeyRef.current) return;
    areasKeyRef.current = key;

    areaPolysRef.current.forEach((p) => p.setMap(null));
    areaPolysRef.current = [];
    facilityBadgesRef.current.forEach((b) => b.setMap(null));
    facilityBadgesRef.current = [];

    const { shape, clusters } = buildAreas(areas);
    shape.forEach((rings) =>
      areaPolysRef.current.push(
        new kakao.maps.Polygon({
          map,
          // 첫 링은 바깥 테두리, 나머지는 구멍
          path: rings.map((ring) => ring.map(([lng, lat]) => new kakao.maps.LatLng(lat, lng))),
          strokeWeight: 1.5,
          strokeColor: COLORS.nonsmoking,
          strokeOpacity: 0.7,
          fillColor: COLORS.nonsmoking,
          fillOpacity: 0.08,
          zIndex: 0,
        })
      )
    );
    if (!showBadges) return;
    clusters.forEach(({ members, at }) => {
      if (!at) return;
      const badge = new kakao.maps.Marker({
        map,
        position: new kakao.maps.LatLng(at.lat, at.lng),
        image: badgeImage(kakao),
        zIndex: 0,
      });
      kakao.maps.event.addListener(badge, "click", () => openAreaInfo(members, badge));
      facilityBadgesRef.current.push(badge);
    });
  };

  // 금연 규칙 대상 시설을 DB(서버)에서 불러와 금연 범위로 표시. 축소/확대와 상관없이 지도에 보이는 영역 전체가 대상
  const fetchFacilities = async () => {
    const map = mapRef.current;
    const reqId = ++facilityReqRef.current;
    // 꺼져 있거나 너무 넓게 보고 있으면 조회하지 않고 지움 (넓게 볼 때는 어차피 그리지 않으니 서버 호출도 아낌)
    if (!map || !flagsRef.current.showNon || map.getLevel() > AREA_MAX_LEVEL) {
      facilityAreasRef.current = [];
      return drawAreas();
    }
    const b = map.getBounds();
    const sw = b.getSouthWest();
    const ne = b.getNorthEast();
    const qs = new URLSearchParams({ south: sw.getLat(), west: sw.getLng(), north: ne.getLat(), east: ne.getLng() });
    const rows = await fetch(`/api/facilities?${qs}`).then((r) => r.json());
    if (reqId !== facilityReqRef.current) return; // 더 최근 요청이 있으면 버림

    // 화면에서 1픽셀이 몇 m인지: 몇 픽셀도 안 되는 작은 범위는 그려도 보이지 않으니 건너뜀 (축소했을 때 성능)
    const widthM = (ne.getLng() - sw.getLng()) * 111320 * Math.cos((sw.getLat() * Math.PI) / 180);
    const mpp = widthM / (document.getElementById("map").clientWidth || 800);
    let areas = [];
    for (const f of rows) {
      const t = RULE_BY_KEY[f.type_key];
      if (!t || t.hidden || (t.include && !t.include(f.name))) continue;
      const size = extentM(f);
      if (size / mpp < 3) continue;
      areas.push({
        lat: f.lat, lng: f.lng, r: f.r, area: f.area, size, name: f.name, label: t.label, rule: t.rule, source: t.source, basis: t.basis,
        exact: !!f.area && !t.approx, // 시설 경계선을 알고 있는지 (금연거리는 도로 위치로 추정한 범위라 제외)
        badge: !!f.area || f.r > 15, // 작은 범위(출입구, 정류장 등)는 배지 없이 범위만 표시
      });
    }
    if (areas.length > 3000) areas = areas.sort((a, b) => b.size - a.size).slice(0, 3000);
    facilityAreasRef.current = areas;
    drawAreas();
  };

  const fetchZones = async () => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    const sw = b.getSouthWest();
    const ne = b.getNorthEast();
    const qs = new URLSearchParams({
      south: sw.getLat(), west: sw.getLng(), north: ne.getLat(), east: ne.getLng(),
    });
    zonesRef.current = await fetch(`/api/zones?${qs}`).then((r) => r.json());
    drawZones();
  };

  // 켜져 있는 종류만 마커/원으로 그림
  const drawZones = () => {
    const map = mapRef.current;
    const { showSmoking, showNon } = flagsRef.current;
    const zones = zonesRef.current.filter((z) => (z.type === "smoking" ? showSmoking : showNon));
    markersRef.current.forEach((m) => m.setMap(null));
    // 비흡연구역은 반경(radius_m)만큼의 범위를 금연 범위에 포함
    zoneAreasRef.current = zones
      .filter((z) => z.type === "nonsmoking" && z.radius_m)
      .map((z) => ({ lat: z.lat, lng: z.lng, r: z.radius_m, name: z.name, basis: "law", badge: false })); // 이미 핀이 있어 배지는 생략
    drawAreas();
    markersRef.current = zones.map((z) => {
      const marker = new kakao.maps.Marker({
        map,
        position: new kakao.maps.LatLng(z.lat, z.lng),
        image: pinImage(kakao, z.type),
        title: z.name,
      });
      kakao.maps.event.addListener(marker, "click", () => {
        if (z.type === "smoking") {
          // 흡연시설: 오른쪽 패널에서 사진/후기 보기
          infoRef.current.close();
          setSelectedId(z.id);
          return;
        }
        // 비흡연구역: 후기 없이 간단한 말풍선만
        setSelectedId(null);
        const el = document.createElement("div");
        el.className = "info";
        el.innerHTML = `<b></b><br><small></small><br><small></small>`;
        el.querySelector("b").textContent = z.name;
        const [s1, s2] = el.querySelectorAll("small");
        const range = z.radius_m ? ` · 반경 ${z.radius_m}m` : "";
        s1.textContent = `비흡연구역${range} · ${z.address ?? ""}`;
        s2.textContent = z.note ?? "";
        infoRef.current.setContent(el);
        infoRef.current.open(map, marker);
      });
      return marker;
    });
  };

  useEffect(() => {
    if (!kakao) return;
    const map = new kakao.maps.Map(document.getElementById("map"), {
      center: new kakao.maps.LatLng(37.4990, 127.0560), // 강남구 한가운데 (지역을 바꾸려면 이 좌표와 backend/facilities_tool.py 의 REGIONS 를 같이 바꿈)
      level: 6,
    });
    mapRef.current = map;
    infoRef.current = new kakao.maps.InfoWindow({ removable: true });
    let timer;
    setZoomLevel(map.getLevel());
    kakao.maps.event.addListener(map, "idle", () => {
      setZoomLevel(map.getLevel());
      fetchZones();
      // 시설 검색은 호출이 많아서, 지도 이동이 멈춘 뒤 한 번만 실행
      clearTimeout(timer);
      timer = setTimeout(fetchFacilities, 400);
    });
    fetchZones();
    fetchFacilities();
  }, [kakao]);

  useEffect(() => {
    if (!mapRef.current) return;
    infoRef.current.close();
    drawZones();
    fetchFacilities();
  }, [showSmoking, showNon]);

  if (error) return <div className="error">{error.message}</div>;

  return (
    <div className="app">
      <div id="map" />
      {showNon && zoomLevel > AREA_MAX_LEVEL && <div className="hint">금연구역은 지도를 더 확대하면 보여요</div>}
      <div className="credit">경계선: © OpenStreetMap contributors</div>
      {selectedId && <ZonePanel zoneId={selectedId} onClose={() => setSelectedId(null)} />}
      <div className={`fab-group ${menuOpen ? "open" : ""}`}>
        <button
          className="fab main"
          title={menuOpen ? "접기" : "흡연/비흡연구역 보기"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <CigaretteIcon />
        </button>
        <button
          className={`fab sub smoking ${showSmoking ? "on" : ""}`}
          title={`흡연구역 ${showSmoking ? "숨기기" : "보기"}`}
          aria-pressed={showSmoking}
          onClick={() => setShowSmoking((v) => !v)}
        >
          <CigaretteIcon />
        </button>
        <button
          className={`fab sub nonsmoking ${showNon ? "on" : ""}`}
          title={`비흡연구역·금연시설 ${showNon ? "숨기기" : "보기"}`}
          aria-pressed={showNon}
          onClick={() => setShowNon((v) => !v)}
        >
          <CigaretteIcon slash />
        </button>
      </div>
    </div>
  );
}
