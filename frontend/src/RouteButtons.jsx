// 장소 옆 [출발 | 도착] 버튼 (지도 앱처럼 눌러서 길찾기 출발지/도착지로 지정)
// place: { name, lat, lng, address? }
export default function RouteButtons({ place, onPick, className = "" }) {
  if (!onPick) return null;
  const pick = (e, which) => {
    e.stopPropagation(); // 목록 항목 클릭(지도 이동·상세 열기)과 겹치지 않게
    onPick(which, place);
  };
  return (
    <span className={`od-btns ${className}`} role="group" aria-label={`${place.name} 길찾기`}>
      <button type="button" className="od-start" onClick={(e) => pick(e, "start")}>
        출발
      </button>
      <button type="button" className="od-end" onClick={(e) => pick(e, "end")}>
        도착
      </button>
    </span>
  );
}
