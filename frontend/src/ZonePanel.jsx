import { useEffect, useRef } from "react";
import LoginButton from "./LoginButton.jsx";
import ReviewSection from "./ReviewSection.jsx";
import { useAuth } from "./auth.js";

const TYPE_LABEL = { smoking: "흡연구역", nonsmoking: "비흡연구역" };

// 오른쪽 후기 패널 (후기 보기). 일반 장소(type: "place", label: 종류) 또는 건물(type: "building")의 정보를 보여주고, 후기는 로그인한 사람에게만 보여줌
export default function ZonePanel({ zone, onClose, onAuthExpired }) {
  const { user } = useAuth(); // 패널이 열릴 때 서버에 로그인 상태를 다시 확인
  const closeRef = useRef(null);
  // 건물(building)이 아니면 일반 장소(place). 흡연구역은 후기를 받지 않아 이 패널을 열지 않음
  const targetType = zone.type === "building" ? "building" : "place";

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

      <div className="panel-body">
        <header className="panel-head">
          <span className={`badge ${zone.type}`}>{TYPE_LABEL[zone.type] ?? zone.label}</span>
          <h2>{zone.name}</h2>
          {zone.address && zone.address !== zone.name && <p className="addr">{zone.address}</p>}
          {zone.note && <p className="note">{zone.note}</p>}
          {zone.radius_m && <p className="note">금연 반경 약 {zone.radius_m}m</p>}
        </header>

        <ReviewSection
          key={`${targetType}:${targetType === "building" ? zone.address : zone.id}`}
          targetType={targetType}
          targetId={String(zone.id)}
          name={zone.name}
          address={zone.address}
          onAuthExpired={onAuthExpired}
        />
      </div>
    </aside>
  );
}
