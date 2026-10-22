import { useEffect, useRef, useState } from "react";
import { useKakao } from "./useKakaoMap.js";
import { RULE_BY_KEY } from "./facilities.js";
import SearchBox from "./SearchBox.jsx";
import ZoneList from "./ZoneList.jsx";
import RoutePanel, { ME } from "./RoutePanel.jsx";
import Roulette from "./Roulette.jsx";
import QuitAd from "./QuitAd.jsx";
import SmokeModeSlider from "./SmokeModeSlider.jsx";
import { BADGE, zoneKind, zoneMarkerImage } from "./zoneIcons.js";
import { buildAreas } from "./areas.js";
import { findZonesAt } from "./nearbyZone.js";
import LoginButton from "./LoginButton.jsx";
import usePanelOffset from "./usePanelOffset.js";
import LoginDialog from "./LoginDialog.jsx";
import ZonePanel from "./ZonePanel.jsx";
import { requireLogin, useAuth } from "./auth.js";
import { findPlacesAt, LABEL_PRIORITY } from "./nearbyPlaces.js";
import { listReviewedPlaces } from "./reviews.js";
import { boundsAround, mostReviewed, nearestSpot, sameSpot } from "./recommend.js";

// 흡연자 기준 색: 피워도 되는 곳(흡연구역)은 초록, 피우면 안 되는 곳(금연구역)은 빨강. styles.css 의 --smoking / --nonsmoking 과 같은 값
const COLORS = { smoking: "#1f9d55", nonsmoking: "#e5484d" };
// 카카오 지도 레벨은 숫자가 작을수록 많이 확대한 것. 화면이 복잡해지지 않게 확대했을 때만 금연구역을 보여줌
const AREA_MAX_LEVEL = 3; // 이 레벨 이하로 확대했을 때만 금연구역 범위 표시
const BADGE_MAX_LEVEL = 3; // 이 레벨 이하로 확대했을 때만 금연구역 배지 표시
const ZONE_MAX_LEVEL = 3; // 이 레벨 이하로 확대했을 때만 공공 흡연구역 핀·목록 표시
const ALERT_MAX_LEVEL = 3; // 이 레벨 이하로 확대했을 때만 내 위치의 금연구역 경보(파동·라벨) 표시
const REVIEW_MAX_LEVEL = 3; // 이 레벨 이하로 확대했을 때만 후기 핀·목록 표시
// 금연구역은 사용자 눈에는 보이지 않게 하고, 위치(GPS) 판단 등 내부에서만 쓸 예정. 개발 중 확인할 때만 true로
const SHOW_NONSMOKING_AREAS = false;

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

// 내 위치 시작점: 항상 강남역 (앱을 켜면 이 자리에 내 위치 마커가 뜨고, 마우스로 끌어 옮길 수 있음). 지도 첫 화면 중심도 여기
// 내 위치가 금연구역 안이면 마커에 붙이는 경고 파동. 주변 시설은 넉넉하게 받아 두고, 많이 움직였을 때만 다시 받음
const NEAR_FETCH_LAT = 0.012; // 위도 방향 약 1.3km (넓은 공원 구역까지 포함하려고 넉넉하게)
const NEAR_FETCH_LNG = 0.015; // 경도 방향 약 1.3km
const NEAR_REFRESH_M = 400; // 받아 둔 중심에서 이만큼 벗어나면 다시 받음

// const START_GPS = { lat: 37.49799161931449, lng: 127.02770445495885 }; // 강남역
const START_GPS = { lat: 37.417549281400404, lng: 126.9778486982369 }; // 메가존 클라우드 과천

const svgUri = (svg) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);

// 내 위치 마커: 흰 테두리 파란 점 + 연한 파란 테두리
function myLocImage(kakao) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">
    <circle cx="17" cy="17" r="14" fill="#1e88e5" fill-opacity=".22"/>
    <circle cx="17" cy="17" r="8.5" fill="#1e88e5" stroke="#fff" stroke-width="3"/></svg>`;
  return new kakao.maps.MarkerImage(svgUri(svg), new kakao.maps.Size(34, 34), { offset: new kakao.maps.Point(17, 17) });
}

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

// 후기가 있는 장소·건물 핀: 흡연구역 핀과 같은 모양, 흰 바탕에 초록 테두리·글씨 "흡연리뷰"
function reviewPinImage(kakao) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="51" viewBox="0 0 40 54">
    <defs><filter id="s" x="-30%" y="-20%" width="160%" height="150%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity=".3"/></filter></defs>
    <path filter="url(#s)" d="M20 2C10 2 2 10 2 20c0 13 18 31 18 31s18-18 18-31C38 10 30 2 20 2z" fill="#fff" stroke="#1f9d55" stroke-width="3"/>
    <text x="20" y="20" text-anchor="middle" dominant-baseline="central" fill="#1f9d55" font-size="8.5" font-weight="700"
      font-family="'Malgun Gothic','Apple SD Gothic Neo',sans-serif" textLength="28" lengthAdjust="spacingAndGlyphs">흡연리뷰</text></svg>`;
  return new kakao.maps.MarkerImage(svgUri(svg), new kakao.maps.Size(38, 51), { offset: new kakao.maps.Point(19, 49) });
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

export default function App() {
  const { kakao, error } = useKakao();
  const [sidebarOpen, setSidebarOpen] = useState(true); // 왼쪽 검색 사이드바
  const [visibleSmoking, setVisibleSmoking] = useState([]); // 사이드바 목록: 화면 안 흡연구역
  const [visibleReviewed, setVisibleReviewed] = useState([]); // 사이드바 목록: 화면 안 후기가 있는 장소·건물 (주소별)
  const [listOrigin, setListOrigin] = useState(null); // 목록 거리 기준: 검색으로 고른 장소 (없으면 거리 표시 안 함)
  const [sidebarMode, setSidebarMode] = useState("search"); // "search" | "route"
  const [searchedPlace, setSearchedPlace] = useState(null); // 길찾기 출발지 후보
  const [myPos, setMyPos] = useState({ status: "idle" }); // 내 위치 { status, lat, lng, message }
  const [rouletteOpen, setRouletteOpen] = useState(false); // 오늘의 담배 룰렛
  const [routeStart, setRouteStart] = useState(ME); // 길찾기 출발지 (기본: 내 위치)
  const [routeEnd, setRouteEnd] = useState(null); // 길찾기 도착지
  const [selectedId, setSelectedId] = useState(null); // 정보 카드를 띄운 흡연구역 (사이드바 목록 선택 표시)
  const { user } = useAuth();
  const [reviewZone, setReviewZone] = useState(null); // 오른쪽 후기 패널에 보여줄 흡연구역 또는 일반 장소 (카드에 있던 정보)
  const panelOpen = Boolean(reviewZone && (user || reviewZone.type === "smoking")); // 흡연구역 패널은 후기가 없어 로그인 없이도 엶
  const [myPosRef, myPosStyle] = usePanelOffset(panelOpen); // 후기 패널이 열리면 [내 위치로]도 패널 옆으로 (좁은 화면은 그대로)
  const [showSmoking, setShowSmoking] = useState(true); // 흡연모드 (지도 왼쪽 위 버튼, 처음엔 켜짐). 켜면 흡연구역 핀이 보이고, 길찾기에서 흡연구역을 들르고, 금연 안내와 오늘의 담배가 나타남 (꺼져 있으면 안 보임)
  const [showNon, setShowNon] = useState(true); // 비흡연구역 + 주변 금연시설
  const [zoomLevel, setZoomLevel] = useState(6); // 지금 지도 확대 레벨 (금연구역을 보여줄지 안내하는 데 사용)
  const flagsRef = useRef({});
  flagsRef.current = { showSmoking, showNon };
  const zonesRef = useRef([]);
  const reviewedRef = useRef([]); // 후기가 있는 주소 + 좌표 { address, count, rating, target_id, lat, lng }
  const coordsRef = useRef(new Map()); // 주소 -> 좌표 (카카오 주소 검색은 주소마다 한 번만)
  const reviewMarkersRef = useRef([]); // 후기가 있는 주소의 핀들
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const zoneAreasRef = useRef([]); // 직접 등록한 비흡연구역의 범위
  const facilityAreasRef = useRef([]); // 규칙으로 찾은 금연시설의 범위
  const nearRef = useRef({ lat: null, lng: null, rows: [] }); // 내 위치 주변에서 받아 둔 시설 (금연구역 판단용)
  const pulseRef = useRef(null); // 금연구역 안에 있을 때 내 위치에 띄우는 경고 파동
  const facilityBadgesRef = useRef([]);
  const areaPolysRef = useRef([]);
  const areasKeyRef = useRef("");
  const facilityReqRef = useRef(0);
  const infoRef = useRef(null);
  const searchCardRef = useRef(null); // 검색으로 고른 장소의 카드
  const searchMarkersRef = useRef([]); // 검색 결과 핀들
  const searchedPlaceRef = useRef(null); // 검색으로 고른 장소 (목록 거리 기준)
  const routeOverlaysRef = useRef([]); // 길찾기 경로 선
  const myLocRef = useRef(null); // 내 위치 파란 점 마커
  const [gpsDrag, setGpsDrag] = useState(true); // 내 위치 마커를 마우스로 끌어 옮길 수 있는지 (지도 위 [위치 이동] 버튼)
  const gpsDragRef = useRef(gpsDrag);
  gpsDragRef.current = gpsDrag;
  const clickCardRef = useRef(null); // 지도의 장소를 눌렀을 때 뜨는 장소 정보 카드
  const clickReqRef = useRef(0);
  // 길찾기 도착지 주변 추천: { loading, error, near, place } (흡연모드에서 도착지가 있을 때만, 아니면 null)
  const [recommend, setRecommend] = useState(null);
  const [reviewedList, setReviewedList] = useState([]); // reviewedRef 와 같은 내용. 바뀌면 추천을 다시 계산하려고 상태로도 둠
  const recommendAddrsRef = useRef([]); // 추천된 후기 장소 주소들: 이 핀들은 확대 레벨과 상관없이 보임
  const recommendOverlaysRef = useRef([]); // 추천 이름표와 추천 흡연구역 핀

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
    closeClickCard(); // 열려 있던 정보 카드는 닫음
    infoRef.current.setContent(el);
    infoRef.current.open(mapRef.current, marker);
  };

  // 모든 금연 범위를 하나의 구역으로 합쳐 그림: 겹치는 부분의 선은 없애고, 구역마다 배지는 하나만 둠
  const drawAreas = () => {
    const map = mapRef.current;
    const showAreas = SHOW_NONSMOKING_AREAS && map.getLevel() <= AREA_MAX_LEVEL; // 넓게 볼 때는 금연구역을 그리지 않음
    const areas = showAreas ? [...zoneAreasRef.current, ...facilityAreasRef.current] : [];
    // 지도를 움직여도 범위가 그대로면 다시 그리지 않음 (열려 있는 말풍선이 닫히지 않도록)
    // 배지는 많이 확대했을 때(레벨 3 이하)만 표시. 그보다 넓게 볼 때는 범위만 보여줌 (배지가 너무 빽빽해서)
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
    if (!SHOW_NONSMOKING_AREAS || !map || !flagsRef.current.showNon || map.getLevel() > AREA_MAX_LEVEL) {
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
    setVisibleSmoking(zonesRef.current.filter((z) => z.type === "smoking"));
    filterReviewed();
    // 검색한 장소가 화면 안에 있을 때만 그곳에서의 거리를 보여줌
    const place = searchedPlaceRef.current;
    setListOrigin(place && b.contain(new kakao.maps.LatLng(place.lat, place.lng)) ? place : null);
  };

  // 후기가 있는 주소 중 지금 화면 안에 있는 것만 목록에
  const filterReviewed = () => {
    const b = mapRef.current?.getBounds();
    if (!b) return;
    setVisibleReviewed(reviewedRef.current.filter((p) => p.lat != null && b.contain(new kakao.maps.LatLng(p.lat, p.lng))));
  };

  // 후기가 있는 주소 목록을 받아 좌표로 바꿈 (후기 표에 좌표가 없어서). 서버가 꺼져 있으면 목록 없이 넘어감
  const fetchReviewed = async () => {
    const rows = await listReviewedPlaces().catch(() => []);
    const geocoder = new kakao.maps.services.Geocoder();
    const coordOf = (address) =>
      coordsRef.current.get(address) ??
      new Promise((resolve) =>
        geocoder.addressSearch(address, (res, status) => {
          const c = status === kakao.maps.services.Status.OK ? { lat: +res[0].y, lng: +res[0].x } : {};
          coordsRef.current.set(address, c);
          resolve(c);
        })
      );
    reviewedRef.current = await Promise.all(rows.map(async (r) => ({ ...r, ...(await coordOf(r.address)) })));
    setReviewedList(reviewedRef.current);
    filterReviewed();
    // 핀은 주소마다 하나 (후기 패널은 목록에서만 엶)
    reviewMarkersRef.current.forEach(({ marker }) => marker.setMap(null));
    const image = reviewPinImage(kakao);
    reviewMarkersRef.current = reviewedRef.current
      .filter((p) => p.lat != null)
      .map((p) => {
        const marker = new kakao.maps.Marker({
          position: new kakao.maps.LatLng(p.lat, p.lng),
          title: `${p.address} (★ ${p.rating} · 후기 ${p.count}개)`,
          image,
          clickable: true, // 눌러도 지도 클릭(장소 카드)으로 넘어가지 않게
          zIndex: 1,
        });
        kakao.maps.event.addListener(marker, "click", () => pickReviewed(p));
        return { marker, address: p.address };
      });
    syncReviewMarkers();
  };

  // 후기 핀 보이기: 흡연모드이고 많이 확대했을 때만. 단, 길찾기에서 추천된 후기 장소 1곳은 확대 레벨과 상관없이
  const syncReviewMarkers = () => {
    const map = mapRef.current;
    if (!map) return;
    const zoomedIn = map.getLevel() <= REVIEW_MAX_LEVEL;
    reviewMarkersRef.current.forEach(({ marker, address }) =>
      marker.setMap(flagsRef.current.showSmoking && (zoomedIn || recommendAddrsRef.current.includes(address)) ? map : null)
    );
  };

  // 목록에서 후기 있는 주소를 고르면 건물 후기 패널 (같은 주소의 장소·건물 후기를 모아 봄)
  const pickReviewed = (p) =>
    requireLogin().then(
      (user) =>
        user &&
        setReviewZone({
          id: p.target_id,
          type: "building",
          name: p.address,
          address: p.address,
          note: `후기 ${p.count}개 · ★ ${p.rating}`,
        })
    );

  // 켜져 있는 종류만 마커/원으로 그림
  const drawZones = () => {
    const map = mapRef.current;
    const { showSmoking, showNon } = flagsRef.current;
    const zones = zonesRef.current.filter((z) => (z.type === "smoking" ? showSmoking : showNon));
    markersRef.current.forEach(({ marker }) => marker.setMap(null));
    // 비흡연구역은 반경(radius_m)만큼의 범위를 금연 범위에 포함
    zoneAreasRef.current = zones
      .filter((z) => z.type === "nonsmoking" && z.radius_m)
      .map((z) => ({ lat: z.lat, lng: z.lng, r: z.radius_m, name: z.name, basis: "law", badge: false })); // 이미 핀이 있어 배지는 생략
    drawAreas();
    markersRef.current = zones.map((z) => {
      const marker = new kakao.maps.Marker({
        map: z.type === "smoking" && map.getLevel() > ZONE_MAX_LEVEL ? null : map, // 흡연구역 핀은 많이 확대했을 때만
        position: new kakao.maps.LatLng(z.lat, z.lng),
        image: z.type === "smoking" ? zoneMarkerImage(kakao, zoneKind(z.note)) : pinImage(kakao, z.type), // 흡연구역은 종류별 아이콘
        title: z.name,
      });
      kakao.maps.event.addListener(marker, "click", () => {
        if (z.type === "smoking") return openZoneCard(z); // 흡연구역: 핀 위에 정보 카드
        // 비흡연구역: 간단한 말풍선만
        closeClickCard();
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
      return { marker, smoking: z.type === "smoking" };
    });
  };

  // 흡연구역 핀 보이기: 흡연모드이고 많이 확대했을 때만 (확대·축소 즉시 반영)
  const syncZoneMarkers = () => {
    const map = mapRef.current;
    if (!map) return;
    const zoomedIn = map.getLevel() <= ZONE_MAX_LEVEL;
    markersRef.current.forEach(({ marker, smoking }) => smoking && marker.setMap(zoomedIn ? map : null));
  };

  // 검색 결과로 지도 이동 (이동 후 idle 이벤트로 주변 구역이 다시 불러와짐)
  const goToPlace = (place) => {
    const map = mapRef.current;
    if (!map) return;
    const pos = new kakao.maps.LatLng(place.lat, place.lng);
    infoRef.current.close();
    closeClickCard();
    searchedPlaceRef.current = place;
    setSearchedPlace({ ...place }); // 같은 장소를 다시 골라도 목록 강조가 다시 되도록 매번 새 객체
    map.setLevel(3);
    map.setCenter(pos);
    // 좁은 화면에선 사이드바가 지도를 거의 가리므로 고르면 접음
    if (window.matchMedia("(max-width: 600px)").matches) setSidebarOpen(false);
    // 지도에서 장소를 누를 때와 같은 장소 카드 ([후기 보기] 포함). 결과 핀을 가리지 않게 핀 위에 띄움
    showPlaceCard({ ...place, onPin: true }, null);
    searchCardRef.current = clickCardRef.current;
  };

  // 검색 결과마다 지도에 카카오 기본(파란) 핀. 핀을 누르면 목록에서 고른 것과 같음
  const showSearchMarkers = (places) => {
    searchMarkersRef.current.forEach((m) => m.setMap(null));
    searchMarkersRef.current = places.map((p) => {
      const marker = new kakao.maps.Marker({
        map: mapRef.current,
        position: new kakao.maps.LatLng(p.lat, p.lng),
        title: p.name,
        clickable: true, // 눌러도 지도 클릭(장소 카드)으로 넘어가지 않게
        zIndex: 2,
      });
      kakao.maps.event.addListener(marker, "click", () => goToPlace(p));
      return marker;
    });
  };

  const clearSearch = () => {
    showSearchMarkers([]);
    if (searchCardRef.current && searchCardRef.current === clickCardRef.current) closeClickCard(); // 다른 카드가 떠 있으면 그대로 둠
    searchCardRef.current = null;
    searchedPlaceRef.current = null;
    setSearchedPlace(null);
    setListOrigin(null);
  };

  // 내 위치(lat, lng)가 금연구역 안(hits가 있음)이면 마커에 파동과 "금연구역" 라벨을 붙이고, 아니면 뗌
  const placePulse = (lat, lng, hits) => {
    if (!hits.length || mapRef.current.getLevel() > ALERT_MAX_LEVEL) return pulseRef.current?.setMap(null); // 넓게 볼 때는 경보를 띄우지 않음
    if (!pulseRef.current) {
      const el = document.createElement("div");
      el.className = "zone-pulse";
      el.innerHTML = '<span class="ring"></span><span class="ring"></span><span class="ring"></span><span class="base"></span><span class="tag">금연구역</span>';
      pulseRef.current = new kakao.maps.CustomOverlay({ content: el, xAnchor: 0, yAnchor: 0, zIndex: 3 });
    }
    pulseRef.current.getContent().title = hits.map((h) => `${h.label} · ${h.name}`).join(", "); // 마우스를 올리면 어떤 시설인지
    pulseRef.current.setPosition(new kakao.maps.LatLng(lat, lng));
    // 이미 지도에 붙어 있으면 다시 붙이지 않음 (다시 붙이면 라벨이 깜빡이며 사라졌다 나타남). 위치만 옮김
    if (pulseRef.current.getMap() !== mapRef.current) pulseRef.current.setMap(mapRef.current);
  };

  // 내 위치 = 파란 점 마커. 브라우저 GPS는 쓰지 않고 항상 강남역(START_GPS)에서 시작하며,
  // 마우스로 끌어서 놓은 자리가 내 위치가 됨 (새로고침하면 다시 강남역)
  const locate = () => {
    // 이미 있으면 끌어 옮긴 자리를 그대로 씀. 단, 지도가 새로 만들어졌으면(개발 중 화면 갱신 등) 새 지도에 다시 붙임
    if (myLocRef.current) {
      if (myLocRef.current.getMap() !== mapRef.current) myLocRef.current.setMap(mapRef.current);
      return;
    }
    setMyPos({ status: "ok", ...START_GPS });
    const marker = new kakao.maps.Marker({
      map: mapRef.current,
      position: new kakao.maps.LatLng(START_GPS.lat, START_GPS.lng),
      image: myLocImage(kakao),
      draggable: gpsDragRef.current,
      clickable: true, // 눌러도 지도 클릭(장소 카드)으로 넘어가지 않게
      zIndex: 4,
      title: gpsDragRef.current ? "내 위치 (끌어서 옮길 수 있어요)" : "내 위치",
    });
    // 끌어서 놓으면 그 자리를 내 위치로 (길찾기 출발지가 '내 위치'면 경로도 다시 찾음)
    // 끄는 동안에도 파동과 라벨이 마커를 따라다니며, 구역에 들어가면 나타나고 벗어나면 사라짐 (받아 둔 주변 시설로 바로 계산)
    kakao.maps.event.addListener(marker, "drag", () => {
      if (!flagsRef.current.showSmoking) return;
      const p = marker.getPosition();
      placePulse(p.getLat(), p.getLng(), findZonesAt(nearRef.current.rows, p.getLat(), p.getLng()));
    });
    kakao.maps.event.addListener(marker, "dragend", () => {
      const p = marker.getPosition();
      setMyPos({ status: "ok", lat: p.getLat(), lng: p.getLng() });
    });
    myLocRef.current = marker;
  };

  // 흡연모드를 켰을 때만: 내 위치가 금연구역 안이면 마커에 빨간 경고 파동과 "금연구역" 표시 (구역 밖이면 아무것도 없음)
  useEffect(() => {
    const hide = () => pulseRef.current?.setMap(null);
    if (!kakao || !showSmoking || myPos.status !== "ok" || !mapRef.current) return hide();
    let cancelled = false;
    (async () => {
      const KX = 111_320 * Math.cos((myPos.lat * Math.PI) / 180);
      const c = nearRef.current;
      const far = c.lat === null || Math.hypot((myPos.lng - c.lng) * KX, (myPos.lat - c.lat) * 111_320) > NEAR_REFRESH_M;
      if (far) {
        const qs = new URLSearchParams({
          south: myPos.lat - NEAR_FETCH_LAT, north: myPos.lat + NEAR_FETCH_LAT, west: myPos.lng - NEAR_FETCH_LNG, east: myPos.lng + NEAR_FETCH_LNG,
        });
        try {
          const rows = await fetch(`/api/facilities?${qs}`).then((r) => (r.ok ? r.json() : []));
          nearRef.current = { lat: myPos.lat, lng: myPos.lng, rows };
        } catch {
          return; // 서버를 못 받으면 이번에는 판단하지 않음
        }
      }
      if (cancelled) return;
      placePulse(myPos.lat, myPos.lng, findZonesAt(nearRef.current.rows, myPos.lat, myPos.lng));
    })();
    return () => {
      cancelled = true;
    };
  }, [kakao, showSmoking, myPos.status, myPos.lat, myPos.lng, zoomLevel > ALERT_MAX_LEVEL]);

  // [내 위치로] 버튼: 지도를 내 위치 마커(끌어 옮겼으면 옮긴 자리)로 이동
  // 왼쪽 사이드바가 지도를 덮고 있으면 그만큼 비켜서, 보이는 영역의 가운데에 마커가 오게 함
  const goToMyPos = () => {
    const map = mapRef.current;
    if (!map) return;
    locate(); // 마커가 없거나 예전 지도에 붙어 있으면 다시 띄움
    const box = document.getElementById("map").getBoundingClientRect();
    const sidebar = document.querySelector(".sidebar.open")?.getBoundingClientRect();
    const covered = sidebar && sidebar.right < box.right - 200 ? sidebar.right - box.left : 0; // 좁은 화면에선 무시
    const proj = map.getProjection();
    const p = proj.containerPointFromCoords(myLocRef.current.getPosition());
    map.panTo(proj.coordsFromContainerPoint(new kakao.maps.Point(p.x - covered / 2, p.y)));
  };

  // [위치 이동] 버튼으로 내 위치 마커 끌기를 켜고 끔
  useEffect(() => {
    const marker = myLocRef.current;
    if (!marker) return;
    marker.setDraggable(gpsDrag);
    marker.setTitle(gpsDrag ? "내 위치 (끌어서 옮길 수 있어요)" : "내 위치");
  }, [gpsDrag]);

  const clearRoute = () => {
    routeOverlaysRef.current.forEach((o) => o.setMap(null));
    routeOverlaysRef.current = [];
  };

  // 경로(path: [[lat, lng], ...])를 파란 선으로 그리고, 출발/도착과 도로 사이 빈 구간은 점선으로 이음
  // segments(대중교통)가 있으면 구간마다 색을 달리 그림: 도보는 회색 점선, 버스는 파랑, 지하철은 초록
  const showRoute = (path, start, end, segments) => {
    const map = mapRef.current;
    clearRoute();
    const ll = ([lat, lng]) => new kakao.maps.LatLng(lat, lng);
    const pts = path.map(ll);
    const startPt = ll([start.lat, start.lng]);
    const endPt = ll([end.lat, end.lng]);
    const line = (p, dash, color = "#1e88e5") =>
      new kakao.maps.Polyline({
        map,
        path: p,
        strokeWeight: dash ? 3 : 6,
        strokeColor: color,
        strokeOpacity: dash ? 0.7 : 0.9,
        strokeStyle: dash ? "shortdash" : "solid",
        zIndex: 3,
      });
    const SEG_COLOR = { BUS: "#1e88e5", SUBWAY: "#7b4fd6", WALKING: "#777" }; // 지하철은 흡연구역(초록)과 헷갈리지 않게 보라
    const segLines = (segments ?? [])
      .filter((s) => s.path.length > 1)
      .map((s) => line(s.path.map(ll), s.type === "WALKING", SEG_COLOR[s.type] ?? "#1e88e5"));
    // 출발/도착 표시
    const pin = (pos, kind, label) => {
      const el = document.createElement("div");
      el.className = `route-pin ${kind}`;
      el.textContent = label;
      return new kakao.maps.CustomOverlay({ map, position: pos, content: el, yAnchor: 1, zIndex: 5 });
    };
    routeOverlaysRef.current = [
      ...(pts.length
        ? [...(segLines.length ? segLines : [line(pts)]), line([startPt, pts[0]], true), line([pts[pts.length - 1], endPt], true)]
        : [line([startPt, endPt], true)]),
      pin(startPt, "start", "출발"),
      pin(endPt, "end", "도착"),
    ];

    const bounds = new kakao.maps.LatLngBounds();
    [startPt, endPt, ...pts].forEach((p) => bounds.extend(p));
    // 넓은 화면에선 왼쪽 사이드바에 가리지 않게 여백을 더 줌
    const left = window.matchMedia("(min-width: 601px)").matches ? 400 : 40;
    map.setBounds(bounds, 60, 60, 60, left);
  };

  // 장소의 [출발 | 도착] 버튼: 길찾기 출발지/도착지로 넣고 길찾기 화면을 엶
  const pickRoutePoint = (which, p) => {
    const place = { id: p.id, name: p.name, lat: Number(p.lat), lng: Number(p.lng), address: p.address };
    (which === "start" ? setRouteStart : setRouteEnd)(place);
    setSidebarMode("route");
    setSidebarOpen(true);
  };

  const closeClickCard = () => {
    clickReqRef.current++;
    clickCardRef.current?.setMap(null);
    clickCardRef.current = null;
    setSelectedId(null); // 흡연구역 카드였다면 목록의 선택 표시도 해제
  };

  // 지도의 장소(주민센터, 은행, 아파트, 상가, 일반 가게, 버스정류장 등)를 누르면 그 장소의 정보 카드를 띄움
  // 카카오 지도는 바탕 지도의 장소 이름을 눌렀다는 이벤트를 주지 않으므로, 누른 자리 바로 위에 장소가 있을 때만 장소를 누른 것으로 봄
  // 길거리처럼 장소가 없는 곳을 누르면 아무것도 하지 않음 (열려 있던 카드만 닫힘)
  const openClickCard = (latLng) => {
    const map = mapRef.current;
    closeClickCard();
    infoRef.current.close();
    if (map.getLevel() > 4) return; // 장소 이름은 많이 확대했을 때만 지도에 보임
    const reqId = clickReqRef.current;

    // 지도의 장소 이름표는 장소 좌표를 가운데에 두고 가로로 길게 그려지므로(아이콘 + 이름),
    // 누른 지점과의 거리를 화면 픽셀로 재되 가로로 떨어진 건 덜 치고, 이름표 높이를 벗어난 곳은 뺌
    const b = map.getBounds();
    const widthM = (b.getNorthEast().getLng() - b.getSouthWest().getLng()) * 111320 * Math.cos((latLng.getLat() * Math.PI) / 180);
    const mpp = widthM / (document.getElementById("map").clientWidth || 800); // 1픽셀이 몇 m인지
    const proj = map.getProjection();
    const at = proj.containerPointFromCoords(latLng);
    const priority = (p) => {
      const i = LABEL_PRIORITY.indexOf(p.groupCode);
      return i < 0 ? LABEL_PRIORITY.length : i;
    };
    const rank = (places) =>
      places
        .map((p) => {
          const pt = proj.containerPointFromCoords(new kakao.maps.LatLng(p.lat, p.lng));
          const dx = Math.abs(pt.x - at.x);
          const dy = Math.abs(pt.y - at.y);
          return { p, dx, dy, score: Math.hypot(dx * 0.4, dy) };
        })
        .filter((r) => r.dx <= 50 && r.dy <= 10)
        // 거의 같은 자리(3픽셀 이내)면 지도에 이름이 주로 표시되는 종류를 먼저
        .sort((x, y) => Math.round(x.score / 3) - Math.round(y.score / 3) || priority(x.p) - priority(y.p) || x.score - y.score)
        .map((r) => r.p);

    findPlacesAt(kakao, latLng.getLat(), latLng.getLng(), Math.min(150, Math.max(20, mpp * 50)))
      .then(({ places, building }) => {
        if (reqId !== clickReqRef.current) return; // 그새 다른 곳을 눌렀으면 무시
        const place = rank(places)[0];
        if (!place) return; // 길거리, 단지 안 길, 공터 등 장소 이름이 없는 곳
        if (place.groupCode !== "BUS") {
          // 같은 주소(한 건물)에 가게가 여럿이면 목록 카드를 띄워 스크롤로 고르게 함
          const key = place.roadAddress || place.jibunAddress;
          const same = key ? places.filter((p) => p.groupCode !== "BUS" && (p.roadAddress || p.jibunAddress) === key) : [];
          if (same.length > 1) return showBuildingList(place, same, building);
          return showPlaceCard(place, building);
        }
        // 버스정류장은 주소가 없어서 정류장 위치의 주소를 찾아 넣음
        new kakao.maps.services.Geocoder().coord2Address(place.lng, place.lat, (res, status) => {
          if (reqId !== clickReqRef.current) return;
          const a = status === kakao.maps.services.Status.OK ? res[0] : null;
          place.roadAddress = a?.road_address?.address_name || "";
          place.jibunAddress = a?.address?.address_name || "";
          showPlaceCard(place, null);
        });
      });
  };

  // 분류 경로의 마지막 단계 (이름과 같으면 그 앞 단계). 예: '음식점 > 한식 > 국밥' -> '국밥'
  const placeCat = (place) => {
    const path = place.categoryPath ? place.categoryPath.split(" > ") : [place.group];
    let cat = path.pop() || "";
    if (cat && place.name.startsWith(cat) && path.length) cat = path.pop();
    return cat;
  };

  // 카드 제목 옆 배지 (kind: BADGE 의 키)
  const setCardBadge = (el, kind) => {
    el.className = `badge ${kind} cc-badge`;
    el.textContent = BADGE[kind].label;
    el.title = BADGE[kind].title;
  };

  // 카드 안을 누르거나 스크롤할 때 지도 클릭·확대로 다시 처리되지 않도록 막음
  const stopMapEvents = (el) =>
    ["mousedown", "touchstart", "touchmove", "click", "dblclick", "wheel"].forEach((t) =>
      el.addEventListener(t, (e) => e.stopPropagation())
    );

  // 같은 주소(한 건물)에 있는 가게 목록 카드: 건물 이름·주소 + 스크롤되는 가게 목록
  // 가게를 누르면 그 가게의 정보 카드로 바뀌고, 정보 카드의 [← 목록]으로 다시 돌아옴
  const showBuildingList = (clicked, places, building) => {
    closeClickCard();
    const key = clicked.roadAddress || clicked.jibunAddress;
    // 건물 이름: 목록 안에 건물 자체인 장소(빌딩·오피스텔·상가·아파트)가 있으면 그 이름, 없으면 누른 지점의 건물 이름
    const isBuilding = (p) => /^부동산 > .*(빌딩|오피스텔|상가|아파트|주상복합)/.test(p.categoryPath || "");
    const buildingPlace = isBuilding(clicked) ? clicked : places.find(isBuilding);
    const title = buildingPlace?.name || (building?.roadAddress === key && building.name) || "이 건물의 장소";
    // 누른 가게를 맨 위에, 나머지는 이름순. 건물 이름으로 쓴 장소는 제목에 있으니 목록에서 뺌
    const list = [clicked, ...places.filter((p) => p.id !== clicked.id).sort((a, b) => a.name.localeCompare(b.name, "ko"))].filter(
      (p) => p !== buildingPlace
    );
    const el = document.createElement("div");
    el.className = "click-card bl-card";
    el.innerHTML = `
      <button class="cc-close" aria-label="닫기">✕</button>
      <div class="cc-head"><b class="cc-title"></b></div>
      <div class="cc-kind"><span class="cc-badge"></span><span class="cc-cat"></span></div>
      <p class="cc-addr"></p>
      <button type="button" class="cc-reviews">후기 보기</button>
      <ul class="bl-list"></ul>`;
    const q = (s) => el.querySelector(s);
    stopMapEvents(el);
    q(".cc-close").onclick = closeClickCard;
    q(".cc-title").textContent = title;
    setCardBadge(q(".cc-badge"), "building");
    q(".cc-cat").textContent = `${list.length}곳`;
    q(".cc-addr").textContent = key;
    // 건물 후기: 도로명주소로 묶어서, 같은 건물이면 어느 가게를 눌러 들어와도 같은 후기 목록 (번호는 처음 누른 장소, 기록용)
    const reviewTarget = { id: clicked.id, type: "building", name: title, address: key, note: `${list.length}곳` };
    q(".cc-reviews").onclick = () => requireLogin().then((user) => user && setReviewZone(reviewTarget));
    const ul = q(".bl-list");
    // 가게 카드를 접을 때는 펼칠 때를 거꾸로 돌려 왼쪽으로 밀어 넣고 사라지게 함 (다른 가게로 바꿀 때는 겹치지 않게 바로 뺌)
    const slideClose = (d) => {
      d.classList.add("bl-closing");
      ul.querySelector(".picked")?.classList.remove("picked");
      d.addEventListener("animationend", () => d.remove());
    };
    for (const p of list) {
      const li = document.createElement("li");
      li.innerHTML = `<button type="button" class="bl-item"><b></b><span class="bl-cat"></span><small></small></button>`;
      li.querySelector("b").textContent = p.name;
      li.querySelector(".bl-cat").textContent = placeCat(p);
      li.querySelector("small").textContent = p.phone || "번호 없음";
      // 가게를 누르면 목록 카드 오른쪽에 그 가게의 정보 카드를 붙여 펼침 (목록은 그대로 둠)
      // 이미 펼친 가게를 다시 누르면 접음 (토글)
      li.firstChild.onclick = () => {
        const open = q(".bl-detail:not(.bl-closing)");
        if (open?.dataset.id === String(p.id)) return slideClose(open);
        open?.remove();
        ul.querySelector(".picked")?.classList.remove("picked");
        li.firstChild.classList.add("picked");
        const detail = placeCardEl(p, building, true);
        detail.classList.add("bl-detail");
        detail.dataset.id = p.id;
        detail.querySelector(".cc-close").onclick = () => slideClose(detail);
        el.append(detail);
        keepCardInView(detail);
      };
      ul.appendChild(li);
    }

    clickCardRef.current = new kakao.maps.CustomOverlay({
      map: mapRef.current,
      position: new kakao.maps.LatLng(clicked.lat, clicked.lng),
      content: el,
      yAnchor: 1,
      zIndex: 6,
      clickable: true,
    });
    keepCardInView(el);
  };

  // 장소 정보 카드 (카카오맵 장소 카드 모양): 이름·종류, 주소, (우)우편번호 (지번), 전화
  // 아래 버튼: [주소 복사] [출발] [도착] (출발/도착은 이 장소를 길찾기 출발지/도착지로)
  // inList: 건물 목록 카드 옆에 붙이는 가게 카드 (후기는 건물 목록 카드에서 봄)
  const placeCardEl = (place, building, inList) => {
    const el = document.createElement("div");
    el.className = "click-card";
    el.innerHTML = `
      <button class="cc-close" aria-label="닫기">✕</button>
      <div class="cc-head"><b class="cc-title"></b></div>
      <div class="cc-kind"><span class="cc-badge"></span><span class="cc-cat"></span></div>
      <p class="cc-addr"></p>
      <p class="cc-sub"><span class="cc-zip"></span><span class="cc-jibun"></span></p>
      <p class="cc-note"></p>
      <a class="cc-phone"></a>
      <button type="button" class="cc-reviews">후기 보기</button>
      <div class="cc-actions">
        <button type="button" class="cc-copy" title="주소 복사" aria-label="주소 복사">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>
        </button>
        <button type="button" class="cc-start">출발</button>
        <button type="button" class="cc-end">도착</button>
      </div>`;
    const q = (s) => el.querySelector(s);
    stopMapEvents(el);
    q(".cc-close").onclick = closeClickCard;
    q(".cc-start").onclick = () => {
      pickRoutePoint("start", place);
      closeClickCard();
    };
    q(".cc-end").onclick = () => {
      pickRoutePoint("end", place);
      closeClickCard();
    };

    q(".cc-title").textContent = place.name;
    setCardBadge(q(".cc-badge"), place.zone ? "smoking" : "building");
    const cat = placeCat(place);
    q(".cc-cat").textContent = cat;
    if (place.zone) {
      // 흡연구역은 종류 글자가 없어 배지를 제목 옆에 둠 (일반 장소는 제목 아래 줄에 배지 + 종류)
      q(".cc-head").append(q(".cc-badge"));
      q(".cc-kind").remove();
    } else if (!inList && cat) {
      // 주소에 가게가 하나뿐이라 따로 연 카드: 종류를 배지 글자로 (종류가 없으면 [빌딩] 배지 그대로)
      q(".cc-badge").textContent = cat;
      q(".cc-cat").remove();
    }
    const road = place.roadAddress || place.address || "";
    q(".cc-addr").textContent = road || place.jibunAddress;
    // 지번은 도로명주소와 겹치는 앞부분(시·구)을 빼고 동·번지만
    const roadParts = road.split(" ");
    const jibunParts = (place.jibunAddress || "").split(" ");
    // 시 이름은 '서울'과 '서울특별시'처럼 다르게 올 수 있어 앞 두 글자로 비교
    const same = (a, b, i) => a === b || (i === 0 && a?.slice(0, 2) === b?.slice(0, 2));
    for (let i = 0; jibunParts.length > 1 && same(jibunParts[0], roadParts[0], i); i++) {
      jibunParts.shift();
      roadParts.shift();
    }
    q(".cc-jibun").textContent = road && place.jibunAddress ? `(지번) ${jibunParts.join(" ")}` : "";
    const setZip = (zip) => (q(".cc-zip").textContent = zip ? `(우) ${zip}` : "");
    if (building && building.roadAddress === road) setZip(building.zipCode);
    else if (road) {
      // 우편번호는 장소 검색 결과에 없어서 주소로 한 번 더 찾음
      new kakao.maps.services.Geocoder().addressSearch(road, (res, status) => {
        if (status === kakao.maps.services.Status.OK) setZip(res[0]?.road_address?.zone_no);
      });
    }
    q(".cc-note").textContent = place.note ?? "";
    // 후기 보기 (일반 장소 카드): 서버에 로그인을 확인하고, 로그인 전이면 로그인 창을 띄워 로그인하면 이어서 오른쪽 패널을 엶
    // 카드에 있는 정보로 패널 내용을 만듦 (서버·DB는 부르지 않음). 흡연구역 카드는 같은 버튼이 [정보 보기]
    const reviewTarget = {
      id: place.id,
      type: "place",
      label: cat || "장소",
      name: place.name,
      address: road || place.jibunAddress,
      note: place.phone ? `☎ ${place.phone}` : "",
    };
    q(".cc-reviews").onclick = () => requireLogin().then((user) => user && setReviewZone(reviewTarget));
    if (place.zone) {
      // 흡연구역은 후기를 받지 않으므로 [정보 보기]로 사이드바 목록에서 고를 때와 같은 오른쪽 패널을 엶 (로그인 불필요)
      q(".cc-reviews").textContent = "정보 보기";
      q(".cc-reviews").onclick = () => setReviewZone(place.zone);
    }
    if (inList) q(".cc-reviews").remove(); // 건물 목록에서 연 가게는 후기를 건물 목록 카드에서 봄
    if (inList) q(".cc-badge").remove(); // 건물 배지는 옆의 건물 목록 카드에 이미 있음
    if (place.onPin) el.classList.add("cc-on-pin"); // 핀 마커 위에 띄울 때는 핀을 가리지 않게 더 위로
    const phone = q(".cc-phone");
    phone.textContent = place.phone;
    if (place.phone) phone.href = `tel:${place.phone}`;
    const copy = q(".cc-copy");
    copy.onclick = () =>
      navigator.clipboard?.writeText(`${place.name} ${road || place.jibunAddress}`).then(() => {
        copy.classList.add("done");
        copy.title = "복사됨";
      });
    return el;
  };

  const showPlaceCard = (place, building) => {
    const el = placeCardEl(place, building);
    clickCardRef.current = new kakao.maps.CustomOverlay({
      map: mapRef.current,
      position: new kakao.maps.LatLng(place.lat, place.lng),
      content: el,
      yAnchor: 1,
      zIndex: 6,
      clickable: true,
    });
    keepCardInView(el);
  };

  // 카드가 화면 가장자리나 왼쪽 사이드바, 위쪽 버튼들에 가려지면 카드가 다 보이도록 지도를 옮김
  // 카카오 오버레이는 조금 뒤에 화면에 붙으므로, 붙을 때까지 잠깐씩 기다렸다가 잼
  const keepCardInView = (el, tries = 10) => {
    if (!el.isConnected || !el.getBoundingClientRect().width) {
      if (tries > 0) setTimeout(() => keepCardInView(el, tries - 1), 30);
      return;
    }
    const map = mapRef.current;
    const box = document.getElementById("map").getBoundingClientRect();
    const sidebar = document.querySelector(".sidebar.open")?.getBoundingClientRect();
    const pad = 12;
    const left = Math.max(box.left, sidebar && sidebar.right < box.right - 200 ? sidebar.right : box.left) + pad;
    const top = box.top + 64; // 위쪽 흡연/금연 버튼과 로그인 버튼 자리
    const panel = document.querySelector(".panel")?.getBoundingClientRect(); // 오른쪽 후기 패널
    const right = (panel && panel.left > box.left + 300 ? Math.min(box.right, panel.left) : box.right) - pad;
    const bottom = box.bottom - pad;
    const r = el.getBoundingClientRect();
    // 사이드바와 패널 사이가 카드보다 좁으면 오른쪽(패널 쪽)에 맞춤 -> 카드 왼쪽 일부가 사이드바에 걸림
    const dx = r.right > right ? right - r.right : r.left < left ? Math.min(left - r.left, right - r.right) : 0;
    const dy = r.top < top ? top - r.top : r.bottom > bottom ? bottom - r.bottom : 0;
    if (!dx && !dy) return;
    // 지도 중심을 반대로 옮기면 카드가 (dx, dy)만큼 움직임 (panBy는 애니메이션이라 화면이 가려져 있으면 안 움직여서 바로 이동)
    const proj = map.getProjection();
    const c = proj.containerPointFromCoords(map.getCenter());
    map.setCenter(proj.coordsFromContainerPoint(new kakao.maps.Point(c.x - dx, c.y - dy)));
  };

  // 흡연구역 정보 카드: 이름, 주소, 형태(개방형 등) + [정보 보기] + [주소 복사] [출발] [도착]
  const openZoneCard = (z) => {
    infoRef.current.close();
    closeClickCard();
    setSelectedId(z.id); // 사이드바 목록에서 선택 표시
    // 서초구 자료처럼 주소 칸에 이름과 같은 위치 설명이 들어 있으면 주소 줄은 생략
    const address = z.address && z.address !== z.name ? z.address : "";
    showPlaceCard(
      {
        id: `zone-${z.id}`,
        name: z.name,
        categoryPath: "", // 종류 글자 없이 [공공] 배지만
        roadAddress: address,
        jibunAddress: "",
        address,
        note: z.note ?? "",
        zone: z, // [후기 보기] 대신 [정보 보기]로 이 구역의 오른쪽 패널을 엶
        phone: "",
        lat: z.lat,
        lng: z.lng,
        onPin: true,
      },
      null
    );
  };

  // 사이드바 목록에서 흡연구역을 고르면 오른쪽 패널만 엶 (지도 카드는 띄우지 않음)
  // 같은 구역을 다시 누르면 패널을 닫음
  const pickZone = (z) => {
    if (reviewZone?.type === "smoking" && reviewZone.id === z.id) return setReviewZone(null);
    setReviewZone(z);
    if (window.matchMedia("(max-width: 600px)").matches) setSidebarOpen(false);
  };
  // 지도 핀·이름표의 클릭 처리는 effect 안에서 한 번 만들어지므로, 지금 열린 패널을 보도록 항상 최신 pickZone 을 부름
  const pickZoneRef = useRef(pickZone);
  pickZoneRef.current = pickZone;

  useEffect(() => {
    if (!kakao) return;
    const map = new kakao.maps.Map(document.getElementById("map"), {
      center: new kakao.maps.LatLng(START_GPS.lat, START_GPS.lng), // 강남역 (내 위치 시작점)
      level: 3,
    });
    mapRef.current = map;
    locate(); // 처음부터 강남역에 내 위치 마커를 띄워 둠
    infoRef.current = new kakao.maps.InfoWindow({ removable: true });
    kakao.maps.event.addListener(map, "click", (e) => openClickCard(e.latLng));
    let timer;
    setZoomLevel(map.getLevel());
    kakao.maps.event.addListener(map, "zoom_changed", () => setZoomLevel(map.getLevel())); // 후기 핀·목록은 확대·축소 즉시 바뀌게
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

  // 처음, 그리고 후기 패널을 닫을 때마다 (후기를 쓰거나 지웠을 수 있음) 후기 있는 주소를 다시 받음
  useEffect(() => {
    if (kakao && !reviewZone) fetchReviewed();
  }, [kakao, reviewZone]);

  // 흡연모드이고 많이 확대했을 때만 후기 핀을 지도에 올림 (추천된 1곳은 예외)
  useEffect(() => {
    syncReviewMarkers();
    syncZoneMarkers();
  }, [zoomLevel]);

  // 후기 패널이 열리면 떠 있는 카드가 패널에 가려지지 않게 (패널이 미끄러져 들어온 뒤에 잼)
  useEffect(() => {
    if (!reviewZone) return;
    const t = setTimeout(() => clickCardRef.current && keepCardInView(clickCardRef.current.getContent()), 300);
    return () => clearTimeout(t);
  }, [reviewZone]);

  useEffect(() => {
    if (!mapRef.current) return;
    infoRef.current.close();
    drawZones();
    fetchFacilities();
    // 후기가 있는 장소 핀도 흡연모드일 때만 (많이 확대했을 때만)
    syncReviewMarkers();
  }, [showSmoking, showNon]);

  // 길찾기 도착지 주변 추천: 흡연모드에서 길찾기 화면에 도착지가 있으면 바로 (출발지는 없어도 됨)
  // 흡연구역은 화면과 상관없이 도착지 주변 범위로 따로 받고, 후기 장소는 받아 둔 전체 목록에서 고름
  const routeDest = routeEnd?.isMe ? (myPos.lat != null ? { lat: myPos.lat, lng: myPos.lng } : null) : routeEnd;
  const destLat = sidebarMode === "route" && showSmoking ? routeDest?.lat : undefined;
  const destLng = sidebarMode === "route" && showSmoking ? routeDest?.lng : undefined;
  const [recommendZones, setRecommendZones] = useState({ key: null, rows: [], error: false });
  useEffect(() => {
    if (destLat == null || destLng == null) return;
    const key = `${destLat},${destLng}`;
    let cancelled = false;
    setRecommendZones({ key: null, rows: [], error: false });
    const qs = new URLSearchParams({ ...boundsAround({ lat: destLat, lng: destLng }), type: "smoking" });
    fetch(`/api/zones?${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((rows) => !cancelled && setRecommendZones({ key, rows, error: false }))
      .catch(() => !cancelled && setRecommendZones({ key, rows: [], error: true }));
    return () => {
      cancelled = true;
    };
  }, [destLat, destLng]);

  useEffect(() => {
    if (destLat == null || destLng == null) return setRecommend(null);
    const dest = { lat: destLat, lng: destLng };
    const loaded = recommendZones.key === `${destLat},${destLng}`;
    setRecommend({
      loading: !loaded,
      error: loaded && recommendZones.error,
      near: loaded ? nearestSpot(recommendZones.rows, reviewedList, dest) : null, // 공공 흡연구역 + 후기 장소 중 가장 가까운 곳
      place: mostReviewed(reviewedList, dest),
    });
  }, [destLat, destLng, recommendZones, reviewedList]);

  // 추천된 두 곳의 지도 표시: 흡연구역 핀(화면 밖 조회로 찾은 곳일 수 있어 따로 하나 더) + 이름표, 후기 핀은 레벨과 상관없이
  useEffect(() => {
    if (!kakao || !mapRef.current) return;
    const map = mapRef.current;
    recommendOverlaysRef.current.forEach((o) => o.setMap(null));
    recommendOverlaysRef.current = [];
    const tag = (p, text, kind, onClick) => {
      // 바깥 상자 아래쪽 여백만큼 핀 머리 위로 띄움 (yAnchor는 바깥 상자 기준)
      const el = document.createElement("div");
      el.className = "rec-tag-wrap";
      el.innerHTML = `<span class="rec-tag ${kind}"></span>`;
      el.firstChild.textContent = text;
      // 바깥 상자가 핀을 덮어 핀 클릭이 막히므로, onClick 이 있으면 이 상자가 클릭을 받아 핀과 같은 동작을 함
      if (onClick) {
        el.style.pointerEvents = "auto";
        el.style.cursor = "pointer";
        el.onclick = onClick;
      }
      // 장소 정보 카드(zIndex 6)보다 아래에 깔리게 5 (카드를 닫으면 다시 보임)
      return new kakao.maps.CustomOverlay({ map, position: new kakao.maps.LatLng(p.lat, p.lng), content: el, yAnchor: 1, zIndex: 5, clickable: Boolean(onClick) });
    };
    // 추천 장소를 누르면: 공공 흡연구역은 목록과 같은 pickZone 으로 오른쪽 패널, 후기 장소는 다른 후기 핀과 같은 pickReviewed 로 후기 패널
    const open = (p) => (p.kind === "zone" ? pickZoneRef.current(p) : pickReviewed(p));
    const { near, place } = recommend ?? {};
    const same = sameSpot(near, place); // 같은 후기 장소면 핀 하나에 이름표 하나
    if (near?.kind === "zone") {
      const marker = new kakao.maps.Marker({
        map,
        position: new kakao.maps.LatLng(near.lat, near.lng),
        image: zoneMarkerImage(kakao, zoneKind(near.note)),
        title: near.name,
        clickable: true,
        zIndex: 2,
      });
      kakao.maps.event.addListener(marker, "click", () => open(near));
      recommendOverlaysRef.current.push(marker);
    }
    // 이름표가 핀을 덮어 핀 클릭이 막히므로 이름표도 같은 동작으로 클릭을 받음. 이름표 색은 장소 종류(공공 / 후기)로
    if (near) recommendOverlaysRef.current.push(tag(near, same ? "가장 가까운 · 리뷰가 많은" : "가장 가까운", near.kind, () => open(near)));
    if (place && !same) recommendOverlaysRef.current.push(tag(place, "리뷰가 많은", "review", () => open(place)));
    // 추천된 후기 장소 핀은 확대 레벨과 상관없이 보임
    recommendAddrsRef.current = [near, place].filter((p) => p?.kind === "review").map((p) => p.address);
    syncReviewMarkers();
  }, [kakao, recommend?.near?.kind, recommend?.near?.id, recommend?.near?.address, recommend?.place?.address]);

  // 패널의 추천 칸을 누르면 지도를 그곳으로 옮기고, 흡연구역은 목록과 같은 오른쪽 패널(pickZone) / 후기 장소는 후기 패널
  const pickRecommend = (p) => {
    mapRef.current?.setCenter(new kakao.maps.LatLng(p.lat, p.lng));
    if (p.kind === "zone") pickZone(p);
    else pickReviewed(p);
    if (window.matchMedia("(max-width: 600px)").matches) setSidebarOpen(false);
  };

  if (error) return <div className="error">{error.message}</div>;

  return (
    <div className={`app ${sidebarOpen ? "sidebar-open" : ""}`}>
      <div id="map" />
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`} aria-label="검색과 길찾기">
        {sidebarMode === "route" && (
          <RoutePanel
            kakao={kakao}
            getCenter={() => mapRef.current?.getCenter()}
            myPos={myPos}
            start={routeStart}
            end={routeEnd}
            setStart={setRouteStart}
            setEnd={setRouteEnd}
            smoking={showSmoking}
            recommend={recommend}
            onPickRecommend={pickRecommend}
            onLocate={locate}
            onShowRoute={showRoute}
            onClearRoute={clearRoute}
            onBack={() => {
              clearRoute();
              setSidebarMode("search");
            }}
          />
        )}
        {/* 검색 화면은 길찾기 중에도 상태(검색어·결과)를 유지하도록 숨기기만 함 */}
        <div className="sidebar-pane" hidden={sidebarMode !== "search"}>
          <div className="sidebar-actions">
            <button
              className="route-entry"
              onClick={() => {
                if (!routeEnd && searchedPlace) setRouteEnd(searchedPlace); // 검색해 둔 장소가 있으면 도착지로
                setSidebarMode("route");
              }}
            >
              <span aria-hidden="true">🚶</span> 길찾기
              <span className="route-entry-arrow" aria-hidden="true">›</span>
            </button>
            {showSmoking && (
              <button className="roulette-entry" onClick={() => setRouletteOpen(true)}>
                <span aria-hidden="true">🎯</span> 오늘의 담배
              </button>
            )}
          </div>
          <SearchBox
            kakao={kakao}
            getCenter={() => mapRef.current?.getCenter()}
            chosen={searchedPlace}
            onSelect={goToPlace}
            onResults={showSearchMarkers}
            onClear={clearSearch}
            onRoutePick={pickRoutePoint}
          >
            {/* 일반 모드에서는 흡연구역·후기 장소 목록을 아예 숨김 */}
            {!showSmoking && (
              <div className="zone-list sidebar-empty">
                <p className="zl-msg">지도 좌측 상단의 버튼으로 흡연 모드를 켜면 흡연구역이 보여요</p>
                <div className="empty-box" aria-hidden="true" />
              </div>
            )}
            {showSmoking && (
              <ZoneList
                zones={zoomLevel > ZONE_MAX_LEVEL ? [] : visibleSmoking}
                zoneHidden={zoomLevel > ZONE_MAX_LEVEL}
                origin={listOrigin}
                // 패널이 열린 구역, 없으면 지도 핀 카드를 띄운 구역을 선택 표시
                selectedId={reviewZone?.type === "smoking" ? reviewZone.id : selectedId}
                onPick={pickZone}
                reviewed={visibleReviewed}
                reviewHidden={zoomLevel > REVIEW_MAX_LEVEL}
                // 목록은 누를 때마다 열기/닫기 (이미 그 주소의 후기 패널이 열려 있으면 닫음)
                openAddress={reviewZone?.type === "building" && user ? reviewZone.address : null}
                onPickReviewed={(p) =>
                  reviewZone?.type === "building" && reviewZone.address === p.address ? setReviewZone(null) : pickReviewed(p)
                }
              />
            )}
          </SearchBox>
          {showSmoking && (
            <div className="sidebar-ad">
              <QuitAd slot={0} />
            </div>
          )}
        </div>
        <button
          className="sidebar-tab"
          onClick={() => setSidebarOpen((v) => !v)}
          aria-expanded={sidebarOpen}
          title={sidebarOpen ? "사이드바 접기" : "사이드바 펼치기"}
          aria-label={sidebarOpen ? "사이드바 접기" : "사이드바 펼치기"}
        >
          {sidebarOpen ? "◀" : "▶"}
        </button>
      </aside>
      {SHOW_NONSMOKING_AREAS && showNon && zoomLevel > AREA_MAX_LEVEL && <div className="hint">금연구역은 지도를 더 확대하면 보여요</div>}
      <div className="credit">경계선: © OpenStreetMap contributors</div>
      {rouletteOpen && showSmoking && <Roulette onClose={() => setRouletteOpen(false)} />}

      {/* 후기 패널은 로그인한 동안에만 (로그아웃하면 닫힘). 흡연구역 패널은 예외 */}
      {panelOpen && (
        <ZonePanel
          zone={reviewZone}
          onClose={() => setReviewZone(null)}
          // 다시 로그인하면 이 패널을 이어서 보고, 로그인하지 않고 닫으면 패널도 닫음
          onAuthExpired={() => requireLogin().then((u) => u || setReviewZone(null))}
        />
      )}
      <LoginButton className="absolute top-3.5 right-3.5 z-10" panelOpen={panelOpen} />
      {/* 오른쪽 아래: 지도를 내 위치로 이동 + 확대(+)·축소(−). 후기 패널이 열리면 묶음째 패널 옆으로 비켜 섬 */}
      <div className="map-controls" ref={myPosRef} style={myPosStyle}>
        <button type="button" className="my-pos-btn" onClick={goToMyPos} title="내 위치로 이동" aria-label="내 위치로 이동">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="6.5" />
            <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
        </button>
        <div className="zoom-btns">
          <button type="button" onClick={() => mapRef.current?.setLevel(mapRef.current.getLevel() - 1, { animate: true })} disabled={zoomLevel <= 1} title="확대" aria-label="지도 확대">
            +
          </button>
          <button type="button" onClick={() => mapRef.current?.setLevel(mapRef.current.getLevel() + 1, { animate: true })} disabled={zoomLevel >= 14} title="축소" aria-label="지도 축소">
            −
          </button>
        </div>
      </div>
      <LoginDialog /> {/* 임시: 위치는 팀과 정함 */}
      <SmokeModeSlider on={showSmoking} onChange={setShowSmoking} />
      {/* 내 위치 마커 끌기 켜기/끄기: 지도 왼쪽 아래 구석의 작은 슬라이더 */}
      <button
        type="button"
        className={`gps-drag-toggle ${gpsDrag ? "on" : ""}`}
        role="switch"
        aria-checked={gpsDrag}
        aria-label="내 위치 마커 이동"
        title={gpsDrag ? "내 위치 마커를 끌어서 옮길 수 있어요. 누르면 고정" : "내 위치 마커가 고정돼 있어요. 누르면 끌어서 옮길 수 있음"}
        onClick={() => setGpsDrag((v) => !v)}
      >
        <span className="gps-drag-track" aria-hidden="true">
          <span className="gps-drag-knob" />
        </span>
        위치 이동
      </button>
    </div>
  );
}
