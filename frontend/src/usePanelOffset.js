import { useEffect, useRef, useState } from "react";

const GAP = 14; // 패널 왼쪽 가장자리와 버튼 사이 간격(px)
const MOVE = "right .2s ease-out, top .2s ease-out"; // 옮겨 갈 때 움직임 (움직임 줄이기 설정이면 뺌)

// 오른쪽 후기 패널(.panel)이 열려 있는 동안 지도 오른쪽 위 버튼이 가려지지 않게 비켜 설 style을 돌려줌.
// 패널 폭은 styles.css 한 곳에만 두고, 여기서는 실제로 그려진 폭을 잼.
// narrowStyle: 패널 왼쪽 남은 칸에 버튼이 안 들어갈 만큼 좁을 때 쓸 style. null 이면 옮기지 않음(가려짐)
// 돌려주는 값: [버튼에 달 ref, 버튼에 줄 style]
export default function usePanelOffset(panelOpen, narrowStyle = null) {
  const ref = useRef(null);
  const [offset, setOffset] = useState(null);

  useEffect(() => {
    if (!panelOpen) {
      setOffset(null);
      return;
    }
    const panel = document.querySelector(".panel");
    if (!panel) return;
    const measure = () => {
      const panelW = panel.offsetWidth;
      const selfW = ref.current?.offsetWidth ?? 0;
      const pageW = document.documentElement.clientWidth; // 패널 폭과 같은 레이아웃 기준으로 잰 화면 폭
      if (pageW - panelW >= selfW + GAP * 2) setOffset({ right: panelW + GAP });
      else setOffset(narrowStyle);
    };
    measure();
    // 패널 폭·버튼 폭·화면 폭 중 하나라도 바뀌면 다시 잼
    const ro = new ResizeObserver(measure);
    ro.observe(panel);
    ro.observe(document.documentElement);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
    // narrowStyle 은 부르는 쪽에서 고정 값으로 넘김
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen]);

  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  return [ref, { ...(reduce ? null : { transition: MOVE }), ...offset }];
}
