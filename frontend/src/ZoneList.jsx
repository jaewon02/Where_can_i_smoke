import RouteButtons from "./RouteButtons.jsx";

// 두 좌표 사이 거리(m)
function distance(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const fmtDist = (m) => (m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`);

// 지금 지도 화면 안의 흡연구역 목록
// 검색한 장소(origin)가 있으면 그곳에서 가까운 순
export default function ZoneList({ zones, origin, selectedId, hidden, onPick, onRoutePick }) {
  const items = origin
    ? zones.map((z) => ({ ...z, dist: distance(origin, z) })).sort((a, b) => a.dist - b.dist)
    : zones;

  return (
    <section className="zone-list" aria-label="화면 안 흡연구역">
      <header className="zl-head">
        <h3>
          이 화면의 흡연구역 <b>{zones.length}</b>곳
        </h3>
        {origin && zones.length > 0 && <small className="muted">'{origin.name}'에서 가까운 순</small>}
      </header>

      {hidden && <p className="zl-msg">흡연구역 표시가 꺼져 있어요. 지도에는 안 보이지만 목록은 보여드려요.</p>}
      {zones.length === 0 && <p className="zl-msg">이 화면에는 등록된 흡연구역이 없어요. 지도를 옮기거나 축소해 보세요.</p>}

      <ul>
        {items.map((z) => (
          <li key={z.id} className="zl-row">
            <button className={`zl-item ${z.id === selectedId ? "selected" : ""}`} onClick={() => onPick(z)}>
              <div className="zl-top">
                <b>{z.name}</b>
                {z.dist != null && <span className="zl-dist">{fmtDist(z.dist)}</span>}
              </div>
              {z.address && <small className="zl-addr">{z.address}</small>}
              {z.note && (
                <div className="zl-meta">
                  <span className="muted zl-note">{z.note}</span>
                </div>
              )}
            </button>
            <RouteButtons place={z} onPick={onRoutePick} className="zl-od" />
          </li>
        ))}
      </ul>
    </section>
  );
}
