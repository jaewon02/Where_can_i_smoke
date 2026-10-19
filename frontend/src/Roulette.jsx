import { useEffect, useRef, useState } from "react";
import { CIGARETTES } from "./cigarettes.js";
import QuitAd from "./QuitAd.jsx";

const ROW = 56; // 한 칸 높이(px), 창에는 3칸이 보이고 가운데 칸이 결과
const LOOPS = 14; // 목록을 몇 번 이어 붙여 긴 띠로 만들지
const SPIN_MS = 3600;

// 오늘의 담배 추천: 슬롯머신처럼 이름이 위에서 아래로 촤라라락 내려가다 멈춤
export default function Roulette({ onClose }) {
  const items = CIGARETTES;
  const n = items.length;
  const strip = Array.from({ length: n * LOOPS }, (_, i) => items[i % n]);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);
  const reelRef = useRef(null);
  const posRef = useRef(n * (LOOPS - 2)); // 지금 가운데 칸에 있는 띠 위치
  const closeRef = useRef(null);
  const timerRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // 띠의 k번째 칸이 가운데(3칸 중 2번째)에 오도록 위치시킴
  const moveTo = (k, ms) => {
    const el = reelRef.current;
    el.style.transition = ms ? `transform ${ms}ms cubic-bezier(.1,.75,.15,1)` : "none";
    el.style.transform = `translateY(${-(k - 1) * ROW}px)`;
    posRef.current = k;
  };

  useEffect(() => {
    moveTo(posRef.current, 0);
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(timerRef.current);
    };
  }, []);

  const spin = () => {
    if (spinning) return;
    const pick = Math.floor(Math.random() * n);
    // 띠 아래쪽의 같은 이름 칸으로 몰래 되돌린 뒤 → 위쪽 칸(pick)까지 내려오게 해서 매번 여러 바퀴 돌아가 보이게
    moveTo((posRef.current % n) + n * (LOOPS - 2), 0);
    reelRef.current.getBoundingClientRect(); // 되돌린 위치를 먼저 반영(reflow)한 뒤 애니메이션 시작
    const ms = reduceMotion ? 300 : SPIN_MS;
    moveTo(pick + n * (reduceMotion ? LOOPS - 3 : 1), ms);
    setResult(null);
    setSpinning(true);
    timerRef.current = setTimeout(() => {
      setSpinning(false);
      setResult(items[pick]);
    }, ms);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="roulette" role="dialog" aria-modal="true" aria-label="오늘의 담배 뽑기" onClick={(e) => e.stopPropagation()}>
        <button ref={closeRef} className="panel-close" onClick={onClose} aria-label="닫기">
          ✕
        </button>
        <h2>오늘의 담배</h2>
        <p className="muted">돌려서 오늘 피울 담배를 정해 보세요</p>

        <div className={`slot ${spinning ? "spinning" : ""} ${result ? "done" : ""}`} aria-hidden="true">
          <ul className="slot-reel" ref={reelRef}>
            {strip.map((name, i) => (
              <li key={i}>{name}</li>
            ))}
          </ul>
          <span className="slot-frame" />
        </div>

        <div className="roulette-result" aria-live="polite">
          {result ? (
            <>
              오늘의 담배는 <b>{result}</b>!
            </>
          ) : spinning ? (
            "두구두구…"
          ) : (
            " "
          )}
        </div>
        <button className="btn primary" onClick={spin} disabled={spinning}>
          {result ? "다시 돌리기" : "돌리기"}
        </button>
        {result && <QuitAd slot={2} variant="inline" />}
      </div>
    </div>
  );
}
