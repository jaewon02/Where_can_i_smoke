import { useEffect, useRef, useState } from "react";
import RouteButtons from "./RouteButtons.jsx";
import { toPlace } from "./nearbyPlaces.js";

// 키워드로 장소를 찾고, 없으면 주소로 한 번 더 찾음 (최대 15건)
export function searchPlaces(kakao, query, center) {
  const { services } = kakao.maps;
  return new Promise((resolve) => {
    new services.Places().keywordSearch(
      query,
      (data, status) => {
        if (status === services.Status.OK) {
          return resolve(
            // 지도에서 장소를 누를 때와 같은 모양으로 (고르면 같은 장소 카드를 띄움)
            data.map((p) => ({
              ...toPlace(p),
              category: p.category_name?.split(" > ").pop() ?? "",
            }))
          );
        }
        new services.Geocoder().addressSearch(query, (data, status) => {
          if (status !== services.Status.OK) return resolve([]);
          resolve(
            data.map((a, i) => ({
              id: `addr-${i}`,
              name: a.road_address?.address_name || a.address_name,
              address: a.road_address ? a.address_name : "",
              category: "주소",
              lat: Number(a.y),
              lng: Number(a.x),
            }))
          );
        }, { size: 15 });
      },
      { location: center, size: 15 }
    );
  });
}

// chosen: 지도에 카드가 떠 있는 결과 (목록에서든 핀에서든 고를 때마다 새 객체라 같은 걸 다시 골라도 강조됨)
// children: 검색 결과 목록이 접혀 있을 때 그 아래에 보여줄 내용 (화면 안 흡연구역 목록)
export default function SearchBox({ kakao, getCenter, chosen, onSelect, onResults, onClear, onRoutePick, children }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null); // null이면 목록 닫힘
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false); // 검색 결과 목록 펼침
  const reqRef = useRef(0);

  const search = async (e) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || !kakao) return;
    const reqId = ++reqRef.current;
    setLoading(true);
    const found = await searchPlaces(kakao, q, getCenter());
    if (reqId !== reqRef.current) return; // 더 최근 검색이 있으면 버림
    setLoading(false);
    setResults(found);
    onResults(found);
    setExpanded(true);
    setActive(found.length ? 0 : -1);
  };

  // 골라도 결과 목록은 그대로 둠 (다른 후보를 바로 고를 수 있게. 흡연구역 목록은 [접기]로 봄)
  const choose = (r) => onSelect(r);

  // 지도 핀을 눌러 고르면 목록에서 그 결과를 마우스를 올린 것처럼 칠하고 보이게 스크롤
  useEffect(() => {
    const i = results?.findIndex((r) => r.id === chosen?.id) ?? -1;
    if (i < 0) return;
    setActive(i);
    document.getElementById(`search-r-${i}`)?.scrollIntoView({ block: "nearest" });
  }, [chosen]);

  const clear = () => {
    reqRef.current++;
    setQuery("");
    setResults(null);
    setLoading(false);
    onClear();
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault(); // type=search 기본 동작(입력값 지우기) 막고 목록만 접음
      return setExpanded(false);
    }
    if (!results?.length || !expanded) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + results.length) % results.length);
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      choose(results[active]);
    }
  };

  return (
    <div className="search">
      <form className="search-bar" role="search" onSubmit={search}>
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setResults(null);
            if (results) onResults([]); // 목록이 사라지면 지도의 결과 핀도 지움
          }}
          onKeyDown={onKeyDown}
          placeholder="장소, 주소 검색"
          aria-label="장소, 주소 검색"
          aria-expanded={!!results?.length && expanded}
          aria-controls="search-results"
          aria-activedescendant={expanded && active >= 0 ? `search-r-${active}` : undefined}
          role="combobox"
          autoComplete="off"
        />
        {query && (
          <button type="button" className="search-clear" onClick={clear} aria-label="검색어 지우기">
            ✕
          </button>
        )}
        <button type="submit" className="search-go" aria-label="검색" disabled={loading}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
        </button>
      </form>

      {loading && <p className="search-msg">검색 중…</p>}
      {!loading && results?.length === 0 && <p className="search-msg">검색 결과가 없어요</p>}
      {!loading && results?.length > 0 && (
        <button type="button" className="search-toggle" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          검색 결과 {results.length}개 {expanded ? "접기 ▴" : "보기 ▾"}
        </button>
      )}
      {!loading && results?.length > 0 && expanded && (
        <ul className="search-results" id="search-results" role="listbox">
          {results.map((r, i) => (
            <li
              key={r.id}
              id={`search-r-${i}`}
              role="option"
              aria-selected={i === active}
              className={`${i === active ? "active" : ""} ${r.id === chosen?.id ? "chosen" : ""}`}
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(r)}
            >
              <div className="sr-top">
                <b>{r.name}</b>
                {r.category && <span className="muted">{r.category}</span>}
              </div>
              <div className="sr-bottom">
                {r.address && <small>{r.address}</small>}
                <RouteButtons place={r} onPick={onRoutePick} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {!(results?.length > 0 && expanded) && children}
    </div>
  );
}
