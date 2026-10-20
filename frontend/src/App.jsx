import { useEffect, useRef, useState } from "react";
import { useKakao } from "./useKakaoMap.js";
import { RULE_BY_KEY } from "./facilities.js";
import SearchBox from "./SearchBox.jsx";
import ZoneList from "./ZoneList.jsx";
import RoutePanel, { ME } from "./RoutePanel.jsx";
import Roulette from "./Roulette.jsx";
import QuitAd from "./QuitAd.jsx";
import { buildAreas } from "./areas.js";
import LoginButton from "./LoginButton.jsx";
import LoginDialog from "./LoginDialog.jsx";
import ZonePanel from "./ZonePanel.jsx";
import { isLoggedIn, useAuth } from "./auth.js";
import { findPlacesAt, LABEL_PRIORITY } from "./nearbyPlaces.js";

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
  const [sidebarOpen, setSidebarOpen] = useState(true); // 왼쪽 검색 사이드바
  const [visibleSmoking, setVisibleSmoking] = useState([]); // 사이드바 목록: 화면 안 흡연구역
  const [listOrigin, setListOrigin] = useState(null); // 목록 거리 기준: 검색으로 고른 장소 (없으면 거리 표시 안 함)
  const [sidebarMode, setSidebarMode] = useState("search"); // "search" | "route"
  const [searchedPlace, setSearchedPlace] = useState(null); // 길찾기 출발지 후보
  const [myPos, setMyPos] = useState({ status: "idle" }); // 내 위치 { status, lat, lng, message }
  const [rouletteOpen, setRouletteOpen] = useState(false); // 오늘의 담배 룰렛
  const [routeStart, setRouteStart] = useState(ME); // 길찾기 출발지 (기본: 내 위치)
  const [routeEnd, setRouteEnd] = useState(null); // 길찾기 도착지
  const [smokingMode, setSmokingMode] = useState(false); // 길찾기 흡연모드 (켜면 금연 안내가 더 많이 뜸)
  const [adClosed, setAdClosed] = useState(false); // 지도 위 금연 안내 카드 닫음 (흡연모드에선 못 닫음)
  const [selectedId, setSelectedId] = useState(null); // 정보 카드를 띄운 흡연구역 (사이드바 목록 선택 표시)
  const { user, remember } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false); // 후기 보기를 눌렀는데 로그인 전이면 띄우는 로그인 창
  const pendingReviewRef = useRef(null); // 로그인 뒤 후기 패널을 열 구역
  const [reviewZone, setReviewZone] = useState(null); // 오른쪽 후기 패널에 보여줄 흡연구역 (지도에서 불러온 구역 정보)
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
  const searchMarkerRef = useRef(null); // 검색으로 고른 위치 표시
  const searchedPlaceRef = useRef(null); // 검색으로 고른 장소 (목록 거리 기준)
  const routeOverlaysRef = useRef([]); // 길찾기 경로 선
  const myLocRef = useRef(null); // 내 위치 파란 점
  const clickCardRef = useRef(null); // 지도의 장소를 눌렀을 때 뜨는 장소 정보 카드
  const clickReqRef = useRef(0);

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
    setVisibleSmoking(zonesRef.current.filter((z) => z.type === "smoking"));
    // 검색한 장소가 화면 안에 있을 때만 그곳에서의 거리를 보여줌
    const place = searchedPlaceRef.current;
    setListOrigin(place && b.contain(new kakao.maps.LatLng(place.lat, place.lng)) ? place : null);
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
      return marker;
    });
  };

  // 검색 결과로 지도 이동 (이동 후 idle 이벤트로 주변 구역이 다시 불러와짐)
  const goToPlace = (place) => {
    const map = mapRef.current;
    if (!map) return;
    const pos = new kakao.maps.LatLng(place.lat, place.lng);
    infoRef.current.close();
    closeClickCard();
    searchMarkerRef.current?.setMap(null);
    searchMarkerRef.current = new kakao.maps.Marker({ map, position: pos, title: place.name, zIndex: 2 });
    searchedPlaceRef.current = place;
    setSearchedPlace(place);
    map.setLevel(3);
    map.setCenter(pos);
    // 좁은 화면에선 사이드바가 지도를 거의 가리므로 고르면 접음
    if (window.matchMedia("(max-width: 600px)").matches) setSidebarOpen(false);
  };

  const clearSearch = () => {
    searchMarkerRef.current?.setMap(null);
    searchMarkerRef.current = null;
    searchedPlaceRef.current = null;
    setSearchedPlace(null);
    setListOrigin(null);
  };

  // 브라우저 위치 권한으로 내 위치를 받아 파란 점으로 표시 (보던 지도 화면은 옮기지 않음)
  const locate = () => {
    if (!navigator.geolocation) {
      return setMyPos({ status: "error", message: "이 브라우저는 위치 확인을 지원하지 않아요." });
    }
    setMyPos((p) => ({ ...p, status: "loading" }));
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const { latitude: lat, longitude: lng } = coords;
        setMyPos({ status: "ok", lat, lng });
        const map = mapRef.current;
        const pos = new kakao.maps.LatLng(lat, lng);
        myLocRef.current?.setMap(null);
        const dot = document.createElement("div");
        dot.className = "my-loc";
        dot.title = "내 위치";
        myLocRef.current = new kakao.maps.CustomOverlay({ map, position: pos, content: dot, zIndex: 4 });
      },
      (err) =>
        setMyPos({
          status: "error",
          message:
            err.code === err.PERMISSION_DENIED
              ? "위치 권한이 거부됐어요. 주소창에서 위치 권한을 허용하거나, 검색한 장소에서 출발해 보세요."
              : "내 위치를 확인하지 못했어요.",
        }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  const clearRoute = () => {
    routeOverlaysRef.current.forEach((o) => o.setMap(null));
    routeOverlaysRef.current = [];
  };

  // 경로(path: [[lat, lng], ...])를 파란 선으로 그리고, 출발/도착과 도로 사이 빈 구간은 점선으로 이음
  // segments(대중교통)가 있으면 구간마다 색을 달리 그림: 도보는 회색 점선, 버스는 파랑, 지하철은 초록
  const showRoute = (path, start, end, via, segments) => {
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
    // 출발/도착 표시 (내 위치에서 출발하면 파란 점이 이미 있으므로 출발 표시는 생략)
    const pin = (pos, kind, label) => {
      const el = document.createElement("div");
      el.className = `route-pin ${kind}`;
      el.textContent = label;
      return new kakao.maps.CustomOverlay({ map, position: pos, content: el, yAnchor: 1.3, zIndex: 5 });
    };
    routeOverlaysRef.current = [
      ...(pts.length
        ? [...(segLines.length ? segLines : [line(pts)]), line([startPt, pts[0]], true), line([pts[pts.length - 1], endPt], true)]
        : [line([startPt, endPt], true)]),
      ...(start.isMe ? [] : [pin(startPt, "start", "출발")]),
      pin(endPt, "end", "도착"),
      ...(via ? [pin(ll([via.lat, via.lng]), "via", "흡연")] : []),
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
        if (place.groupCode !== "BUS") return showPlaceCard(place, building);
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

  // 장소 정보 카드 (카카오맵 장소 카드 모양): 이름·종류, 주소, (우)우편번호 (지번), 전화
  // 아래 버튼: [주소 복사] [출발] [도착] (출발/도착은 이 장소를 길찾기 출발지/도착지로)
  const showPlaceCard = (place, building) => {
    const el = document.createElement("div");
    el.className = "click-card";
    el.innerHTML = `
      <button class="cc-close" aria-label="닫기">✕</button>
      <div class="cc-head"><b class="cc-title"></b><span class="cc-cat"></span></div>
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
    // 카드 안을 누를 때 지도 클릭으로 다시 처리되지 않도록 막음
    ["mousedown", "touchstart", "click", "dblclick"].forEach((t) => el.addEventListener(t, (e) => e.stopPropagation()));
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
    // 분류 경로의 마지막 단계 (이름과 같으면 그 앞 단계). 예: '음식점 > 한식 > 국밥' -> '국밥'
    const path = place.categoryPath ? place.categoryPath.split(" > ") : [place.group];
    let cat = path.pop() || "";
    if (cat && place.name.startsWith(cat) && path.length) cat = path.pop();
    q(".cc-cat").textContent = cat;
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
    // 후기 보기 (흡연구역 카드만): 로그인했으면 오른쪽 패널에 후기, 아니면 로그인 창을 띄움
    if (place.zone) {
      q(".cc-reviews").onclick = () => {
        if (isLoggedIn()) return setReviewZone(place.zone);
        pendingReviewRef.current = place.zone; // 로그인하면 이어서 후기 패널을 엶
        setLoginOpen(true);
      };
    } else q(".cc-reviews").remove();
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

  // 로그인 창에서 로그인/회원가입에 성공하면: 로그인 상태 기억 + 후기 보기를 누르다 온 경우 이어서 후기 패널
  const onLoginSuccess = (result) => {
    remember(result);
    setLoginOpen(false);
    if (pendingReviewRef.current) setReviewZone(pendingReviewRef.current);
    pendingReviewRef.current = null;
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

  // 흡연구역 정보 카드: 이름, 주소, 형태(개방형 등) + [주소 복사] [출발] [도착]
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
        group: "흡연구역",
        categoryPath: "",
        roadAddress: address,
        jibunAddress: "",
        address,
        note: z.note ?? "",
        zone: z, // [후기 보기] 버튼 (오른쪽 패널에 이 구역 정보와 후기)
        phone: "",
        lat: z.lat,
        lng: z.lng,
        onPin: true,
      },
      null
    );
  };

  // 사이드바 목록에서 흡연구역을 고르면 그 핀 위에 정보 카드 (목록은 화면 안 구역이라 지도는 그대로)
  const pickZone = (z) => {
    openZoneCard(z);
    if (window.matchMedia("(max-width: 600px)").matches) setSidebarOpen(false);
  };

  useEffect(() => {
    if (!kakao) return;
    const map = new kakao.maps.Map(document.getElementById("map"), {
      level: 6,
      center: new kakao.maps.LatLng(37.49799161931449, 127.02770445495885), // 강남역
    });
    mapRef.current = map;
    infoRef.current = new kakao.maps.InfoWindow({ removable: true });
    kakao.maps.event.addListener(map, "click", (e) => openClickCard(e.latLng));
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

  // 후기 패널이 열리면 떠 있는 카드가 패널에 가려지지 않게 (패널이 미끄러져 들어온 뒤에 잼)
  useEffect(() => {
    if (!reviewZone || !user) return;
    const t = setTimeout(() => clickCardRef.current && keepCardInView(clickCardRef.current.getContent()), 300);
    return () => clearTimeout(t);
  }, [reviewZone, user]);

  useEffect(() => {
    if (!mapRef.current) return;
    infoRef.current.close();
    drawZones();
    fetchFacilities();
  }, [showSmoking, showNon]);

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
            smoking={smokingMode}
            onSmokingChange={(on) => {
              setSmokingMode(on);
              if (on) setAdClosed(false);
            }}
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
            <button className="roulette-entry" onClick={() => setRouletteOpen(true)}>
              <span aria-hidden="true">🎯</span> 오늘의 담배
            </button>
          </div>
          <SearchBox
            kakao={kakao}
            getCenter={() => mapRef.current?.getCenter()}
            onSelect={goToPlace}
            onClear={clearSearch}
            onRoutePick={pickRoutePoint}
          >
            <ZoneList
              zones={visibleSmoking}
              origin={listOrigin}
              selectedId={selectedId}
              hidden={!showSmoking}
              onPick={pickZone}
              onRoutePick={pickRoutePoint}
            />
          </SearchBox>
          <div className="sidebar-ad">
            <QuitAd slot={0} />
          </div>
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
      {showNon && zoomLevel > AREA_MAX_LEVEL && <div className="hint">금연구역은 지도를 더 확대하면 보여요</div>}
      <div className="credit">경계선: © OpenStreetMap contributors</div>
      {rouletteOpen && <Roulette onClose={() => setRouletteOpen(false)} />}
      {/* 지도 위 금연 안내: 평소엔 오른쪽 아래 1개(닫기 가능), 흡연모드면 위쪽 띠 + 왼쪽 아래까지 더 띄움 */}
      {(!adClosed || smokingMode) && (
        <div className="map-ad right">
          <QuitAd slot={5} variant="float" onClose={smokingMode ? undefined : () => setAdClosed(true)} />
        </div>
      )}
      {smokingMode && (
        <>
          <div className="map-ad top">
            <QuitAd slot={3} variant="strip" />
          </div>
          <div className="map-ad left">
            <QuitAd slot={4} variant="float" />
          </div>
        </>
      )}
      {/* 후기 패널은 로그인한 동안에만 (로그아웃하면 닫힘) */}
      {reviewZone && user && (
        <ZonePanel zone={reviewZone} onClose={() => setReviewZone(null)} />
      )}
      <LoginButton className="absolute top-3.5 right-3.5 z-10" />
      <LoginDialog
        open={loginOpen}
        onOpenChange={(open) => {
          setLoginOpen(open);
          if (!open) pendingReviewRef.current = null; // 로그인하지 않고 닫으면 후기 화면으로 넘어가지 않음
        }}
        onSuccess={onLoginSuccess}
      /> {/* 임시: 위치는 팀과 정함 */}
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
