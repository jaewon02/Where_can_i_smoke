import { useEffect, useRef } from "react";
import ReviewSection from "./ReviewSection.jsx";

const TYPE_LABEL = { smoking: "흡연구역", nonsmoking: "비흡연구역" };

// 오른쪽 후기 패널. zone: 흡연구역 정보 또는 일반 장소 { kind: "place", id(카카오 장소 번호), name, address, group }. 후기는 서버에서 불러옴
export default function ZonePanel({ zone, onClose, onAuthExpired }) {
  const closeRef = useRef(null);

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
          {zone.kind === "place" ? <span className="badge bg-gray-600">{zone.group || "장소"}</span> : <span className={`badge ${zone.type}`}>{TYPE_LABEL[zone.type]}</span>}
          <h2>{zone.name}</h2>
          {zone.address && zone.address !== zone.name && <p className="addr">{zone.address}</p>}
          {zone.note && <p className="note">{zone.note}</p>}
          {zone.radius_m && <p className="note">금연 반경 약 {zone.radius_m}m</p>}
        </header>
        <ReviewSection
          key={`${zone.kind ?? "zone"}:${zone.id}`}
          targetType={zone.kind === "place" ? "place" : "zone"}
          targetId={String(zone.id)}
          name={zone.name}
          address={zone.address}
          onAuthExpired={onAuthExpired}
        />
      </div>
    </aside>
  );
}
