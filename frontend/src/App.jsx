import { useEffect, useRef, useState } from "react";
import { useKakao } from "./useKakaoMap.js";
import { FACILITY_TYPES, searchAll } from "./facilities.js";
import ZonePanel from "./ZonePanel.jsx";

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
    <div className="app">
      <div id="map" />
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
