import { useEffect, useRef } from "react";
import LoginButton from "./LoginButton.jsx";
import ReviewSection from "./ReviewSection.jsx";
import { useAuth } from "./auth.js";
import { badgeOf, zoneKind } from "./zoneIcons.js";
import { ZONE_GUIDE } from "./zoneGuide.js";

// 흡연구역 종류별 이용 안내: 어떤 곳인지, 이용 에티켓, 주의할 점
function ZoneGuide({ kind }) {
  const g = ZONE_GUIDE[kind];
  return (
    <section aria-label={g.title} className="zone-guide">
      <h3>{g.title}</h3>
      <p className="zg-intro">{g.intro}</p>
      <h4>이용 에티켓</h4>
      <ul className="zg-list ok">
        {g.manners.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <h4>주의하세요</h4>
      <ul className="zg-list warn">
        {g.cautions.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </section>
  );
}

// 오른쪽 후기 패널 (후기 보기). 일반 장소(type: "place", label: 종류) 또는 건물(type: "building")의 정보를 보여주고, 후기는 로그인한 사람에게만 보여줌
export default function ZonePanel({ zone, onClose, onAuthExpired, onReviewsChange }) {
  const { user } = useAuth(); // 패널이 열릴 때 서버에 로그인 상태를 다시 확인
  const closeRef = useRef(null);
  // 건물(building)이 아니면 일반 장소(place). 흡연구역은 후기 대신 빈 칸을 보여줌
  const targetType = zone.type === "building" ? "building" : "place";
  const badge = badgeOf(zone);

  useEffect(() => {
    closeRef.current?.focus();
  }, [zone.id]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="panel" role="dialog" aria-label={zone.name}>
      <button ref={closeRef} className="panel-close" onClick={onClose} aria-label="닫기">
        ✕
      </button>

      <div className="panel-body flex min-h-full flex-col">
        <header className="panel-head">
          <span className={`badge ${zone.type}`} title={badge.title}>
            {badge.label}
          </span>
          <h2>{zone.name}</h2>
          {zone.address && zone.address !== zone.name && <p className="addr">{zone.address}</p>}
          {zone.note && <p className="note">{zone.note}</p>}
          {zone.radius_m && <p className="note">금연 반경 약 {zone.radius_m}m</p>}
        </header>

        {/* 흡연구역은 후기를 받지 않아 종류별 이용 안내를 보여줌 */}
        {zone.type === "smoking" ? (
          <ZoneGuide kind={zoneKind(zone.note)} />
        ) : (
          <ReviewSection
            key={`${targetType}:${targetType === "building" ? zone.address : zone.id}`}
            targetType={targetType}
            targetId={String(zone.id)}
            name={zone.name}
            address={zone.address}
            onAuthExpired={onAuthExpired}
            onReviewsChange={onReviewsChange}
          />
        )}
      </div>
    </aside>
  );
}
