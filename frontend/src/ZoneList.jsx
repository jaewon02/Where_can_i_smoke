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

// 지금 지도 화면 안의 흡연구역 + 후기가 있는 장소·건물(주소별로 묶음)을 한 목록으로
// 검색한 장소(origin)가 있으면 둘을 섞어 그곳에서 가까운 순
// 후기 장소는 누르면 그 주소의 후기 패널을 열고 닫음 (openAddress: 지금 열린 주소)
// zoneHidden·reviewHidden: 지도를 넓게 볼 때는 공공 흡연구역·후기 장소 대신 목록 끝에 안내 한 줄만
export default function ZoneList({ zones, origin, selectedId, onPick, reviewed, zoneHidden, reviewHidden, openAddress, onPickReviewed }) {
  const all = [...(zoneHidden ? [] : zones), ...(reviewHidden ? [] : reviewed.map((p) => ({ ...p, reviewed: true })))];
  const hiddenMsg =
    zoneHidden && reviewHidden ? "흡연구역과 후기가 있는 장소는" : zoneHidden ? "흡연구역은" : reviewHidden ? "후기가 있는 장소는" : null;
  const items = origin ? all.map((z) => ({ ...z, dist: distance(origin, z) })).sort((a, b) => a.dist - b.dist) : all;

  return (
    <section className="zone-list" aria-label="화면 안 흡연 장소">
      <header className="zl-head">
        <h3>
          이 화면의 흡연 장소 <b>{all.length}</b>곳
        </h3>
        {origin && all.length > 0 && <small className="muted">'{origin.name}'에서 가까운 순</small>}
      </header>

      {all.length === 0 && !(zoneHidden && reviewHidden) && <p className="zl-msg">이 화면에는 흡연구역이나 후기가 있는 장소가 없어요. 지도를 옮기거나 축소해 보세요.</p>}

      <ul>
        {items.map((z) =>
          z.reviewed ? (
            <li key={`r-${z.address}`}>
              <button
                className={`zl-item ${z.address === openAddress ? "selected" : ""}`}
                aria-pressed={z.address === openAddress}
                onClick={() => onPickReviewed(z)}
              >
                <div className="zl-top">
                  <b>{z.address}</b>
                  {z.dist != null && <span className="zl-dist">{fmtDist(z.dist)}</span>}
                </div>
                <small className="zl-addr">
                  ★ {z.rating} · 후기 {z.count}개
                </small>
              </button>
            </li>
          ) : (
            <li key={z.id}>
              <button
                className={`zl-item ${z.id === selectedId ? "selected" : ""}`}
                aria-pressed={z.id === selectedId}
                onClick={() => onPick(z)}
              >
                <span className="badge smoking zl-official" title="공공 흡연장소">공공</span>
                <div className="zl-top">
                  <b>{z.name}</b>
                  {z.dist != null && <span className="zl-dist">{fmtDist(z.dist)}</span>}
                </div>
                {z.address && <small className="zl-addr">{z.address}</small>}
                {z.note && (
                  <div className="zl-meta">
                    <span className="zl-note">{z.note}</span>
                  </div>
                )}
              </button>
            </li>
          )
        )}
      </ul>

      {hiddenMsg && <p className="zl-msg">{hiddenMsg} 지도를 더 확대하면 보여요</p>}
    </section>
  );
}
