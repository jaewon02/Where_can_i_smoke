// 흡연모드를 켜고 끄는 버튼. 누르면 손잡이가 미끄러지듯 옮겨가며 켜지고 꺼짐
//   on       : 현재 흡연모드 켜짐 여부
//   onChange : (다음 값) => void
const KNOB = 30;
const WIDTH = 68;
const MAX = WIDTH - KNOB - 8; // 손잡이가 움직이는 거리 (양쪽 여백 4px씩)

export default function SmokeModeSlider({ on, onChange }) {
  return (
    <button
      type="button"
      className={`smoke-slider ${on ? "on" : ""}`}
      style={{ width: WIDTH }}
      role="switch"
      aria-checked={on}
      aria-label="흡연모드"
      onClick={() => onChange(!on)}
    >
      <span className="smoke-slider-knob" style={{ width: KNOB, height: KNOB, transform: `translateX(${on ? MAX : 0}px)` }}>
        {/* 담배 한 개비: 꺼져 있으면 불이 안 붙은 상태, 켜지면 끝이 빨갛게 타오르고 연기가 올라감 */}
        <svg className={`smoke-cig ${on ? "lit" : ""}`} viewBox="0 0 28 28" width="26" height="26" aria-hidden="true">
          {on && <path className="smoke-wisp" d="M23 12c-2-2 2-3.5 0-6M19.5 12c-2-2 2-3.5 0-6" fill="none" stroke="#9aa0a6" strokeWidth="1.4" strokeLinecap="round" />}
          <rect x="3" y="15" width="7" height="5.5" rx="1.2" fill="#e8a05a" stroke="#555" strokeWidth="1" />
          <rect x="10" y="15" width="11" height="5.5" fill="#fff" stroke="#555" strokeWidth="1" />
          <rect className="smoke-tip" x="21" y="15" width="4" height="5.5" rx="1.2" fill={on ? "#ff3b1f" : "#8d9399"} stroke="#555" strokeWidth="1" />
        </svg>
      </span>
    </button>
  );
}
