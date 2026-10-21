import { useEffect, useState } from "react";
import { QUIT_ADS, pickAd } from "./ads.js";

// 금연 안내 배너. slot으로 자리마다 다른 문구, 8초마다 다음 문구로 넘어감
// (모든 배너가 같은 시계로 넘어가야 화면에 같은 문구가 겹치지 않음)
// variant: "card"(사이드바·패널 안) | "inline"(결과 아래 한 줄)
export default function QuitAd({ slot = 0, variant = "card", onClose }) {
  const [, rerender] = useState(0);
  const tick = Math.floor(Date.now() / 8000);

  useEffect(() => {
    const id = setInterval(() => rerender((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const ad = pickAd(slot + tick);
  if (!QUIT_ADS.length) return null;

  return (
    <aside className={`quit-ad ${variant}`} aria-label="금연 안내">
      <span className="qa-badge">금연 안내</span>
      <div className="qa-text">
        <b>{ad.title}</b>
        <span>{ad.body}</span>
      </div>
      {onClose && (
        <button className="qa-close" onClick={onClose} aria-label="금연 안내 닫기">
          ✕
        </button>
      )}
    </aside>
  );
}
