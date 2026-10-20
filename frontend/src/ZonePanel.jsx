import { useEffect, useRef, useState } from "react";
import RouteButtons from "./RouteButtons.jsx";

const TYPE_LABEL = { smoking: "흡연구역", nonsmoking: "비흡연구역" };

export default function ZonePanel({ zoneId, onClose, onRoutePick }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const closeRef = useRef(null);

  const load = async () => {
    try {
      const res = await fetch(`/api/zones/${zoneId}`);
      if (!res.ok) throw new Error("정보를 불러오지 못했습니다");
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    setData(null);
    load();
    closeRef.current?.focus();
  }, [zoneId]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const zone = data?.zone;

  return (
    <aside className="panel" role="dialog" aria-label={zone?.name ?? "구역 상세"}>
      <button ref={closeRef} className="panel-close" onClick={onClose} aria-label="닫기">
        ✕
      </button>

      {error && <p className="panel-msg error-text">{error}</p>}
      {!data && !error && <p className="panel-msg">불러오는 중…</p>}

      {zone && (
        <div className="panel-body">
          <header className="panel-head">
            <span className={`badge ${zone.type}`}>{TYPE_LABEL[zone.type]}</span>
            <h2>{zone.name}</h2>
            <p className="addr">{zone.address}</p>
            {zone.note && <p className="note">{zone.note}</p>}
            {zone.radius_m && <p className="note">금연 반경 약 {zone.radius_m}m</p>}
            <RouteButtons place={zone} onPick={onRoutePick} className="panel-od" />
          </header>
        </div>
      )}
    </aside>
  );
}
