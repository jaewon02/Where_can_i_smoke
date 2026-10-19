import { useEffect, useRef, useState } from "react";
import { useKakao } from "./useKakaoMap.js";
import { FACILITY_TYPES, searchAll } from "./facilities.js";
import ZonePanel from "./ZonePanel.jsx";
import SearchBox from "./SearchBox.jsx";
import ZoneList from "./ZoneList.jsx";
import RoutePanel from "./RoutePanel.jsx";
import Roulette from "./Roulette.jsx";
import QuitAd from "./QuitAd.jsx";

const COLORS = { smoking: "#e5484d", nonsmoking: "#1f9d55" };

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
  const [smokingMode, setSmokingMode] = useState(false); // 길찾기 흡연모드 (켜면 금연 안내가 더 많이 뜸)
  const [adClosed, setAdClosed] = useState(false); // 지도 위 금연 안내 카드 닫음 (흡연모드에선 못 닫음)
  const [selectedId, setSelectedId] = useState(null); // 오른쪽 상세 패널에 보여줄 구역
  const [showSmoking, setShowSmoking] = useState(true);
  const [showNon, setShowNon] = useState(true); // 비흡연구역 + 주변 금연시설
  const flagsRef = useRef({});
  flagsRef.current = { showSmoking, showNon };
  const zonesRef = useRef([]);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const circlesRef = useRef([]);
  const facilityCirclesRef = useRef([]);
  const facilityReqRef = useRef(0);
  const infoRef = useRef(null);
  const searchMarkerRef = useRef(null); // 검색으로 고른 위치 표시
  const searchedPlaceRef = useRef(null); // 검색으로 고른 장소 (목록 거리 기준)
  const routeOverlaysRef = useRef([]); // 길찾기 경로 선
  const myLocRef = useRef(null); // 내 위치 파란 점

  // 법정 금연시설(버스정류장 등)을 카카오 장소 검색으로 찾아 점선 원으로 표시
  const fetchFacilities = async () => {
    const map = mapRef.current;
    const reqId = ++facilityReqRef.current;
    const clear = () => {
      facilityCirclesRef.current.forEach((c) => c.setMap(null));
      facilityCirclesRef.current = [];
    };
    if (!map || !flagsRef.current.showNon || map.getLevel() > 5) return clear();

    const bounds = map.getBounds();
    const results = await Promise.all(
      FACILITY_TYPES.map(async (t) => ({ t, places: (await searchAll(kakao, t.keyword, bounds)).filter(t.match) }))
    );
    if (reqId !== facilityReqRef.current) return; // 더 최근 요청이 있으면 버림

    clear();
    const seen = new Set();
    for (const { t, places } of results) {
      for (const p of places) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        const center = new kakao.maps.LatLng(p.y, p.x);
        const circle = new kakao.maps.Circle({
          map,
          center,
          radius: t.radius,
          strokeWeight: 1.5,
          strokeColor: COLORS.nonsmoking,
          strokeStyle: "dash",
          strokeOpacity: 0.6,
          fillColor: COLORS.nonsmoking,
          fillOpacity: 0.06,
          zIndex: 0,
        });
        const badge = new kakao.maps.Marker({ map, position: center, image: badgeImage(kakao), title: p.place_name, zIndex: 0 });
        kakao.maps.event.addListener(badge, "click", () => {
          const el = document.createElement("div");
          el.className = "info";
          el.textContent = `${p.place_name} · 금연구역(추정) 반경 ${t.radius}m`;
          infoRef.current.setContent(el);
          infoRef.current.open(map, badge);
        });
        facilityCirclesRef.current.push(circle, badge);
      }
    }
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
    circlesRef.current.forEach((c) => c.setMap(null));
    // 비흡연구역은 반경(radius_m)만큼 원으로 범위 표시
    circlesRef.current = zones
      .filter((z) => z.type === "nonsmoking" && z.radius_m)
      .map(
        (z) =>
          new kakao.maps.Circle({
            map,
            center: new kakao.maps.LatLng(z.lat, z.lng),
            radius: z.radius_m,
            strokeWeight: 1.5,
            strokeColor: COLORS.nonsmoking,
            strokeOpacity: 0.55,
            fillColor: COLORS.nonsmoking,
            fillOpacity: 0.08,
            zIndex: 1,
          })
      );
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

  // 검색 결과로 지도 이동 (이동 후 idle 이벤트로 주변 구역이 다시 불러와짐)
  const goToPlace = (place) => {
    const map = mapRef.current;
    if (!map) return;
    const pos = new kakao.maps.LatLng(place.lat, place.lng);
    infoRef.current.close();
    setSelectedId(null);
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

  // 브라우저 위치 권한으로 내 위치를 받아 파란 점으로 표시하고 그쪽으로 이동
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
        map.setLevel(4);
        map.setCenter(pos);
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
  const showRoute = (path, start, end, via) => {
    const map = mapRef.current;
    clearRoute();
    const ll = ([lat, lng]) => new kakao.maps.LatLng(lat, lng);
    const pts = path.map(ll);
    const startPt = ll([start.lat, start.lng]);
    const endPt = ll([end.lat, end.lng]);
    const line = (p, dash) =>
      new kakao.maps.Polyline({
        map,
        path: p,
        strokeWeight: dash ? 3 : 6,
        strokeColor: "#1e88e5",
        strokeOpacity: dash ? 0.7 : 0.9,
        strokeStyle: dash ? "shortdash" : "solid",
        zIndex: 3,
      });
    // 출발/도착 표시 (내 위치에서 출발하면 파란 점이 이미 있으므로 출발 표시는 생략)
    const pin = (pos, kind, label) => {
      const el = document.createElement("div");
      el.className = `route-pin ${kind}`;
      el.textContent = label;
      return new kakao.maps.CustomOverlay({ map, position: pos, content: el, yAnchor: 1.3, zIndex: 5 });
    };
    routeOverlaysRef.current = [
      ...(pts.length
        ? [line(pts), line([startPt, pts[0]], true), line([pts[pts.length - 1], endPt], true)]
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

  // 사이드바 목록에서 흡연구역을 고르면 오른쪽 상세 패널 열기 (목록은 화면 안 구역이라 지도는 그대로)
  const pickZone = (z) => {
    infoRef.current.close();
    setSelectedId(z.id);
    if (window.matchMedia("(max-width: 600px)").matches) setSidebarOpen(false);
  };

  useEffect(() => {
    if (!kakao) return;
    const map = new kakao.maps.Map(document.getElementById("map"), {
      center: new kakao.maps.LatLng(37.4175, 126.9774),
      level: 4,
    });
    mapRef.current = map;
    infoRef.current = new kakao.maps.InfoWindow({ removable: true });
    kakao.maps.event.addListener(map, "idle", () => {
      fetchZones();
      fetchFacilities();
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
    <div className={`app ${sidebarOpen ? "sidebar-open" : ""}`}>
      <div id="map" />
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`} aria-label="검색과 길찾기">
        {sidebarMode === "route" && (
          <RoutePanel
            kakao={kakao}
            getCenter={() => mapRef.current?.getCenter()}
            myPos={myPos}
            searchedPlace={searchedPlace}
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
            <button className="route-entry" onClick={() => setSidebarMode("route")}>
              <span aria-hidden="true">🚶</span> 길찾기
              <span className="route-entry-arrow" aria-hidden="true">›</span>
            </button>
            <button className="roulette-entry" onClick={() => setRouletteOpen(true)}>
              <span aria-hidden="true">🎯</span> 오늘의 담배
            </button>
          </div>
          <SearchBox kakao={kakao} getCenter={() => mapRef.current?.getCenter()} onSelect={goToPlace} onClear={clearSearch}>
            <ZoneList zones={visibleSmoking} origin={listOrigin} selectedId={selectedId} hidden={!showSmoking} onPick={pickZone} />
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
      {selectedId && <ZonePanel zoneId={selectedId} onClose={() => setSelectedId(null)} />}
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
