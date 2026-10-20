import { useEffect, useRef } from "react";
import LoginButton from "./LoginButton.jsx";
import { useAuth } from "./auth.js";

const TYPE_LABEL = { smoking: "흡연구역", nonsmoking: "비흡연구역" };

// 오른쪽 후기 패널 (후기 보기). 흡연구역 또는 일반 장소(type: "place", label: 종류)의 정보를 보여주고, 후기는 로그인한 사람에게만 보여줌
export default function ZonePanel({ zone, onClose }) {
  const { user } = useAuth(); // 패널이 열릴 때 서버에 로그인 상태를 다시 확인
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
          <span className={`badge ${zone.type}`}>{TYPE_LABEL[zone.type] ?? zone.label}</span>
          <h2>{zone.name}</h2>
          {zone.address && zone.address !== zone.name && <p className="addr">{zone.address}</p>}
          {zone.note && <p className="note">{zone.note}</p>}
          {zone.radius_m && <p className="note">금연 반경 약 {zone.radius_m}m</p>}
        </header>
        {/* 후기는 아직 저장하는 곳(DB)이 없어서 '후기 없음'만 보여줌 */}
        <section aria-label="후기">
          <h3>후기</h3>
          {user && <p className="muted">아직 등록된 후기가 없어요.</p>}
          {user === null && (
            <>
              <p className="muted">로그인하면 후기를 볼 수 있어요.</p>
              <LoginButton />
            </>
          )}
        </section>
      </div>
    </aside>
  );
}
