import { useEffect, useRef, useState } from "react";
import { searchPlaces } from "./SearchBox.jsx";
import QuitAd from "./QuitAd.jsx";

const ME = { isMe: true, name: "내 위치" };
const fmtDist = (m) => (m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`);
const fmtTime = (s) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))}분` : `${Math.floor(s / 3600)}시간 ${Math.round((s % 3600) / 60)}분`);

// 출발/도착 입력칸: Enter로 장소 검색 → 목록에서 고르기, 또는 [내 위치]
function PlaceInput({ kind, label, value, onChange, kakao, getCenter }) {
  const [text, setText] = useState(value?.name ?? "");
  const [results, setResults] = useState(null);
  const [active, setActive] = useState(0);
  const reqRef = useRef(0);

  useEffect(() => {
    setText(value?.name ?? "");
  }, [value]);

  const search = async () => {
    const q = text.trim();
    if (!q || !kakao) return;
    const reqId = ++reqRef.current;
    setResults("loading");
    const found = await searchPlaces(kakao, q, getCenter());
    if (reqId !== reqRef.current) return;
    setResults(found);
    setActive(0);
  };

  const choose = (place) => {
    reqRef.current++;
    setResults(null);
    onChange(place);
  };

  const onKeyDown = (e) => {
    const list = Array.isArray(results) ? results : [];
    if (e.key === "Escape") {
      e.preventDefault();
      setResults(null);
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && list.length) {
      e.preventDefault();
      setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (list.length) choose(list[active]);
      else search();
    }
  };

  return (
    <div className="place-input">
      <div className="pi-row">
        <span className={`pi-dot ${kind}`} aria-hidden="true" />
        <input
          type="search"
          className={value?.isMe ? "is-me" : ""}
          value={text}
          placeholder={`${label} 검색 후 Enter`}
          aria-label={label}
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value);
            setResults(null);
            if (!e.target.value && value) onChange(null); // 다 지우면 선택 해제 (고르기 전까지는 이전 선택 유지)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setResults(null)}
        />
        {!value?.isMe && (
          <button type="button" className="pi-btn" onClick={() => choose(ME)}>
            내 위치
          </button>
        )}
      </div>
      {results && (
        <ul className="pi-results" role="listbox" aria-label={`${label} 검색 결과`}>
          {results === "loading" && <li className="pi-msg">검색 중…</li>}
          {Array.isArray(results) && results.length === 0 && <li className="pi-msg">검색 결과가 없어요</li>}
          {Array.isArray(results) &&
            results.map((r, i) => (
              <li
                key={r.id}
                role="option"
                aria-selected={i === active}
                className={i === active ? "active" : ""}
                onPointerEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()} // 입력칸 blur로 목록이 먼저 닫히지 않게
                onClick={() => choose(r)}
              >
                <b>{r.name}</b>
                {r.address && <small>{r.address}</small>}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

// 사이드바 길찾기 화면: 출발 → 도착 도보 경로 (TMAP)
export default function RoutePanel({ kakao, getCenter, myPos, searchedPlace, smoking, onSmokingChange, onLocate, onShowRoute, onClearRoute, onBack }) {
  const [start, setStart] = useState(ME);
  const [end, setEnd] = useState(searchedPlace); // 검색해 둔 장소가 있으면 도착지로
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [viaPick, setViaPick] = useState({ key: null, id: null }); // 직접 고른 경유 흡연구역
  const reqRef = useRef(0);

  // "내 위치"는 실제 좌표로 바꿔서 사용
  const resolve = (p) => (p?.isMe ? (myPos.lat != null ? { ...p, lat: myPos.lat, lng: myPos.lng } : null) : p);
  const from = resolve(start);
  const to = resolve(end);
  const usesMe = start?.isMe || end?.isMe;

  useEffect(() => {
    if (usesMe && myPos.status === "idle") onLocate();
  }, [usesMe]);

  // 직접 고른 경유지는 같은 출발/도착일 때만 유효 (없으면 서버가 가장 덜 돌아가는 곳을 고름)
  const routeKey = `${from?.lat},${from?.lng},${to?.lat},${to?.lng},${smoking}`;
  const viaId = viaPick.key === routeKey ? viaPick.id : null;

  // 출발/도착이 모두 정해지면 바로 경로 찾기
  useEffect(() => {
    const reqId = ++reqRef.current;
    setRoute(null);
    setError(null);
    onClearRoute();
    if (!from || !to) return setLoading(false);
    setLoading(true);
    const qs = new URLSearchParams({ from_lat: from.lat, from_lng: from.lng, to_lat: to.lat, to_lng: to.lng });
    if (smoking) {
      qs.set("smoking", "true");
      if (viaId) qs.set("via_zone_id", viaId);
    }
    fetch(`/api/route?${qs}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail ?? "경로를 찾지 못했습니다");
        return data;
      })
      .then((data) => {
        if (reqId !== reqRef.current) return;
        setRoute(data);
        onShowRoute(data.path, from, to, data.via);
      })
      .catch((e) => reqId === reqRef.current && setError(e.message))
      .finally(() => reqId === reqRef.current && setLoading(false));
  }, [from?.lat, from?.lng, to?.lat, to?.lng, smoking, viaId]);

  const swap = () => {
    setStart(end);
    setEnd(start);
  };

  return (
    <div className="route">
      <header className="route-head">
        <button className="route-back" onClick={onBack} aria-label="검색으로 돌아가기">
          ←
        </button>
        <h2>도보 길찾기</h2>
        <label className={`smoke-toggle ${smoking ? "on" : ""}`} title="중간에 흡연구역을 들렀다 가요">
          <span>흡연모드</span>
          <input type="checkbox" role="switch" checked={smoking} onChange={(e) => onSmokingChange(e.target.checked)} />
          <span className="st-track" aria-hidden="true">
            <span className="st-thumb" />
          </span>
        </label>
      </header>

      <div className="route-fields">
        <div className="route-inputs">
          <PlaceInput kind="start" label="출발지" value={start} onChange={setStart} kakao={kakao} getCenter={getCenter} />
          <PlaceInput kind="end" label="도착지" value={end} onChange={setEnd} kakao={kakao} getCenter={getCenter} />
        </div>
        <button className="route-swap" onClick={swap} aria-label="출발지와 도착지 바꾸기" title="출발지 ↔ 도착지">
          ⇅
        </button>
      </div>

      {usesMe && myPos.status === "loading" && <p className="route-msg">내 위치를 확인하는 중…</p>}
      {usesMe && myPos.status === "error" && (
        <p className="route-msg error-text">
          {myPos.message}
          <button className="link-btn" onClick={onLocate}>
            다시 시도
          </button>
        </p>
      )}

      {(loading || route || error) && (
        <div className={`route-result ${error ? "error" : ""}`} aria-live="polite">
          {loading && <p className="route-msg">경로를 찾는 중…</p>}
          {error && <p className="route-msg error-text">{error}</p>}
          {route && (
            <>
              <div className="rr-dest">
                {from.name} → {to.name}
              </div>
              <div className="rr-main">
                도보 <b>{fmtTime(route.time_s)}</b> · {fmtDist(route.distance_m)}
              </div>
              {smoking && route.via && (
                <div className="rr-via">
                  <span className="rr-via-badge">흡연</span> {route.via.name} 들렀다 가요
                </div>
              )}
              {smoking && !route.via && <div className="rr-via none">가는 길 근처에 흡연구역이 없어서 바로 가는 길로 안내해요.</div>}
              {smoking && route.candidates?.length > 1 && (
                <div className="rr-cands" role="radiogroup" aria-label="들를 흡연구역 바꾸기">
                  {route.candidates.map((c) => (
                    <button
                      key={c.id}
                      role="radio"
                      aria-checked={c.id === route.via?.id}
                      className={c.id === route.via?.id ? "on" : ""}
                      onClick={() => setViaPick({ key: routeKey, id: c.id })}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="rr-foot">
                <small className="muted">경로 정보: TMAP</small>
              </div>
              {smoking && <QuitAd slot={0} variant="inline" />}
            </>
          )}
        </div>
      )}

      {!route && !loading && !error && (
        <p className="route-hint">
          출발지와 도착지를 검색해서 고르면 걸어가는 길을 지도에 그려드려요.
          <br />
          도보 경로는 직선 10km 이내만 안내해요.
        </p>
      )}
      <div className="route-ads">
        <QuitAd slot={1} />
        {smoking && <QuitAd slot={2} />}
      </div>
    </div>
  );
}
