import { useEffect, useRef, useState } from "react";
import { searchPlaces } from "./SearchBox.jsx";
import QuitAd from "./QuitAd.jsx";

export const ME = { isMe: true, name: "내 위치" };
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

const MODES = [
  { key: "walk", label: "도보", icon: "🚶" },
  { key: "transit", label: "대중교통", icon: "🚌" },
  { key: "car", label: "자동차", icon: "🚗" },
];
const SEG_LABEL = { WALKING: "도보", BUS: "버스", SUBWAY: "지하철" };
const fmtWon = (n) => `${n.toLocaleString("ko-KR")}원`;

// 대중교통 한 구간 (도보 / 버스 / 지하철)
function TransitStep({ seg }) {
  const kind = SEG_LABEL[seg.type] ?? seg.type ?? "이동";
  return (
    <li className={`ts ts-${(seg.type || "etc").toLowerCase()}`}>
      <span className="ts-badge">{kind}</span>
      <div className="ts-body">
        {seg.type === "WALKING" ? (
          <span>
            {seg.time_s != null && `${fmtTime(seg.time_s)} 걷기`}
            {seg.distance_m != null && ` · ${fmtDist(seg.distance_m)}`}
          </span>
        ) : (
          <>
            <b>
              {seg.vehicles.length ? seg.vehicles.slice(0, 3).join(", ") : kind}
              {seg.vehicles.length > 3 && ` 외 ${seg.vehicles.length - 3}대`}
            </b>
            {seg.from && (
              <small>
                {seg.from}
                {seg.to && ` → ${seg.to}`}
                {seg.stop_count > 0 && ` (${seg.stop_count}${seg.type === "SUBWAY" ? "개 역" : "개 정류장"})`}
              </small>
            )}
            {!seg.from && seg.guidance && <small>{seg.guidance}</small>}
          </>
        )}
      </div>
      {seg.type !== "WALKING" && seg.time_s != null && <span className="ts-time">{fmtTime(seg.time_s)}</span>}
    </li>
  );
}

// 사이드바 길찾기 화면: 출발 → 도착 경로 (도보·대중교통: 카카오맵 / 자동차: 카카오모빌리티)
export default function RoutePanel({ kakao, getCenter, myPos, start, end, setStart, setEnd, smoking, onLocate, onShowRoute, onClearRoute, onBack }) {
  const [mode, setMode] = useState("walk");
  const [route, setRoute] = useState(null);
  const [option, setOption] = useState(0); // 대중교통: 여러 경로 중 몇 번째를 볼지
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

  // 직접 고른 경유지는 같은 출발/도착·이동수단일 때만 유효 (없으면 서버가 가장 덜 돌아가는 곳을 고름)
  const routeKey = `${from?.lat},${from?.lng},${to?.lat},${to?.lng},${smoking},${mode}`;
  const viaId = viaPick.key === routeKey ? viaPick.id : null;

  // 출발/도착이 모두 정해지면 바로 경로 찾기
  useEffect(() => {
    const reqId = ++reqRef.current;
    setRoute(null);
    setOption(0);
    setError(null);
    onClearRoute();
    if (!from || !to) return setLoading(false);
    setLoading(true);
    const qs = new URLSearchParams({ from_lat: from.lat, from_lng: from.lng, to_lat: to.lat, to_lng: to.lng, mode });
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
        const first = data.options?.[0];
        onShowRoute(first?.path ?? data.path, from, to, data.via, first?.segments);
      })
      .catch((e) => reqId === reqRef.current && setError(e.message))
      .finally(() => reqId === reqRef.current && setLoading(false));
  }, [from?.lat, from?.lng, to?.lat, to?.lng, smoking, viaId, mode]);

  const pickOption = (i) => {
    setOption(i);
    const o = route.options[i];
    onShowRoute(o.path, from, to, null, o.segments);
  };

  const swap = () => {
    setStart(end);
    setEnd(start);
  };

  const opt = route?.options?.[option];
  const label = MODES.find((m) => m.key === mode).label;

  return (
    <div className="route">
      <header className="route-head">
        <button className="route-back" onClick={onBack} aria-label="검색으로 돌아가기">
          ←
        </button>
        <h2>길찾기</h2>
      </header>

      <div className="route-modes" role="tablist" aria-label="이동 수단">
        {MODES.map((m) => (
          <button key={m.key} role="tab" aria-selected={mode === m.key} className={mode === m.key ? "on" : ""} onClick={() => setMode(m.key)}>
            <span aria-hidden="true">{m.icon}</span> {m.label}
          </button>
        ))}
      </div>

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

              {mode === "transit" && opt ? (
                <>
                  {route.options.length > 1 && (
                    <div className="rr-options" role="tablist" aria-label="대중교통 경로 선택">
                      {route.options.map((o, i) => (
                        <button key={i} role="tab" aria-selected={i === option} className={i === option ? "on" : ""} onClick={() => pickOption(i)}>
                          {fmtTime(o.time_s)}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="rr-main">
                    <b>{fmtTime(opt.time_s)}</b>
                    {opt.fare != null && ` · ${fmtWon(opt.fare)}`}
                    {opt.transfers != null && ` · 환승 ${opt.transfers}회`}
                  </div>
                  <ol className="transit-steps">
                    {opt.segments.map((s, i) => (
                      <TransitStep key={i} seg={s} />
                    ))}
                  </ol>
                </>
              ) : (
                <div className="rr-main">
                  {label} <b>{fmtTime(route.time_s)}</b> · {fmtDist(route.distance_m)}
                  {mode === "car" && (route.toll > 0 || route.taxi > 0) && (
                    <div className="rr-sub">
                      {route.toll > 0 && `통행료 ${fmtWon(route.toll)}`}
                      {route.toll > 0 && route.taxi > 0 && " · "}
                      {route.taxi > 0 && `택시 약 ${fmtWon(route.taxi)}`}
                    </div>
                  )}
                </div>
              )}

              {smoking && route.smoking_supported === false && (
                <div className="rr-via none">대중교통 길찾기는 경유지를 지원하지 않아 흡연모드가 적용되지 않아요.</div>
              )}
              {smoking && route.smoking_supported !== false && route.via && (
                <div className="rr-via">
                  <span className="rr-via-badge">흡연</span> {route.via.name} 들렀다 가요
                </div>
              )}
              {smoking && route.smoking_supported !== false && !route.via && (
                <div className="rr-via none">가는 길 근처에 흡연구역이 없어서 바로 가는 길로 안내해요.</div>
              )}
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
                <small className="muted">경로 정보: {mode === "car" ? "카카오모빌리티" : "카카오맵"}</small>
              </div>
              {smoking && <QuitAd slot={0} variant="inline" />}
            </>
          )}
        </div>
      )}

      {!route && !loading && !error && (
        <p className="route-hint">
          출발지와 도착지를 검색하거나 지도에서 눌러 고르면 길을 지도에 그려드려요.
          <br />
          도보는 직선 10km, 대중교통은 100km, 자동차는 200km 이내만 안내해요.
        </p>
      )}
      <div className="route-ads">
        {smoking && <QuitAd slot={1} />}
        {smoking && <QuitAd slot={2} />}
      </div>
    </div>
  );
}
