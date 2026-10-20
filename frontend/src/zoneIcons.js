// 흡연구역 종류별 지도 아이콘. 담배 피우는 캐릭터 + 장소 모양으로 한눈에 구분됨
//   open   개방형 구역 (완전 개방형 / 부분 개방형)
//   line   라인형 (바닥에 선만 표시)
//   booth  개방형 흡연부스 (지붕·기둥)
//   solo   비대면 흡연부스 (유리 칸막이 1인 부스)
//   closed 밀폐형 (밀폐형·폐쇄형 부스, 흡연실)

const GREEN = "#1f9d55";
const WHITE = "#fff";
const YELLOW = "#ffd23f";

// DB의 note 첫 칸(시설 형태 표기)을 종류로 바꿈. 표기가 제각각이라 공백을 지우고 키워드로 판단
export function zoneKind(note) {
  const t = (note || "").split(" · ")[0].replace(/\s/g, "");
  if (t.includes("라인형")) return "line";
  if (t.includes("비대면")) return "solo";
  if (t.includes("밀폐") || t.includes("폐쇄") || t.includes("흡연실")) return "closed";
  if (t.includes("부스")) return "booth";
  return "open";
}

export const KIND_LABEL = { open: "개방형", line: "라인형", booth: "개방형 부스", solo: "비대면 부스", closed: "밀폐형·흡연실" };

// 입에 담배를 문 캐릭터. (x, 발 y) 기준, s로 크기 조절
const person = (x, base, s = 1) => `
  <g transform="translate(${x} ${base}) scale(${s})">
    <rect x="-5" y="-15" width="10" height="11" rx="4.5" fill="${WHITE}"/>
    <path d="M-2.4 -5V0M2.4 -5V0" stroke="${WHITE}" stroke-width="3.2" stroke-linecap="round"/>
    <circle cx="0" cy="-21" r="7" fill="${WHITE}"/>
    <circle cx="-2.6" cy="-22" r="1" fill="${GREEN}"/><circle cx="2.4" cy="-22" r="1" fill="${GREEN}"/>
    <path d="M-1.6 -18.6q1.2 1.2 2.4 0" stroke="${GREEN}" stroke-width="1" fill="none" stroke-linecap="round"/>
    <path d="M2.6 -18.4L10 -19.4" stroke="${YELLOW}" stroke-width="2.3" stroke-linecap="round"/>
    <circle cx="10.6" cy="-19.5" r="1.5" fill="#ff5a36"/>
    <path d="M11.6 -22c2.2-2.2-2.2-3.6 0-6s-2-3.4 0-5" stroke="${WHITE}" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".9"/>
  </g>`;

const SCENES = {
  open: `<ellipse cx="24" cy="36" rx="19" ry="6" fill="${WHITE}" fill-opacity=".18" stroke="${WHITE}" stroke-width="2.2" stroke-dasharray="3 2.6"/>
         ${person(24, 35, 0.62)}`,
  line: `<path d="M6 42h36l-6-14H12z" fill="${YELLOW}" fill-opacity=".25" stroke="${YELLOW}" stroke-width="3" stroke-linejoin="round"/>
         ${person(24, 37, 0.62)}`,
  booth: `<path d="M5 16l4-8h30l4 8z" fill="${WHITE}"/>
          <path d="M9 16v25M39 16v25" stroke="${WHITE}" stroke-width="3.6" stroke-linecap="round"/>
          <path d="M5 41h38" stroke="${WHITE}" stroke-width="2" opacity=".7"/>
          ${person(24, 40, 0.6)}`,
  solo: `<rect x="9" y="7" width="30" height="35" rx="5" fill="${WHITE}" fill-opacity=".25" stroke="${WHITE}" stroke-width="3"/>
         <path d="M30 7v35" stroke="${WHITE}" stroke-width="1.8" opacity=".85"/>
         <circle cx="34.5" cy="26" r="1.5" fill="${WHITE}"/>
         ${person(19.5, 40, 0.6)}`,
  closed: `<rect x="7" y="13" width="34" height="29" rx="4" fill="${WHITE}"/>
           <rect x="19" y="24" width="10" height="18" rx="1.5" fill="${GREEN}"/>
           <rect x="21.2" y="26.2" width="5.6" height="6" rx="1" fill="${WHITE}" fill-opacity=".55"/>
           <circle cx="26.6" cy="36.5" r="1" fill="${WHITE}"/>
           <circle cx="14" cy="20" r="3.4" fill="none" stroke="${GREEN}" stroke-width="1.8"/>
           <path d="M14 16.6v6.8M10.6 20h6.8" stroke="${GREEN}" stroke-width="1.4"/>
           <rect x="33" y="6" width="4" height="8" rx="1" fill="${WHITE}"/>
           <path d="M35 4c2-2-2-3.4 0-5.4" stroke="${WHITE}" stroke-width="1.3" fill="none" stroke-linecap="round" opacity=".9"/>`,
};

export function zoneIconSvg(kind) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="52" viewBox="0 0 48 57">
    <defs><filter id="s" x="-30%" y="-20%" width="160%" height="150%"><feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-opacity=".3"/></filter></defs>
    <g filter="url(#s)">
      <path d="M17 44l7 10 7-10z" fill="${GREEN}" stroke="${WHITE}" stroke-width="2.4" stroke-linejoin="round"/>
      <rect x="2.5" y="2.5" width="43" height="43" rx="15" fill="${GREEN}" stroke="${WHITE}" stroke-width="2.6"/>
      <path d="M18.5 43.4h11" stroke="${GREEN}" stroke-width="3.4"/>
    </g>
    ${SCENES[kind] ?? SCENES.open}</svg>`;
}

const cache = {};
export function zoneMarkerImage(kakao, kind) {
  if (!cache[kind]) {
    const uri = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(zoneIconSvg(kind));
    cache[kind] = new kakao.maps.MarkerImage(uri, new kakao.maps.Size(44, 52), { offset: new kakao.maps.Point(22, 50) });
  }
  return cache[kind];
}
