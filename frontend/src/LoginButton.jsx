import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { requireLogin, useAuth } from "./auth.js";
import usePanelOffset from "./usePanelOffset.js";

const TOAST_MS = 2000; // 로그아웃 알림이 떠 있는 시간
// 좁은 화면: 패널 위 [✕] 버튼(오른쪽 10px, 폭 34px) 바로 왼쪽에 띄움
const NARROW_STYLE = { right: 52, top: 10, zIndex: 30 };

// 시험용 로그인 버튼. 로그인 전에는 [로그인]으로 창을 열고, 로그인 뒤에는 닉네임과 [로그아웃]을 보여 줌
// panelOpen: 오른쪽 후기 패널이 열렸는지. 열리면 패널 왼쪽 옆으로 비켜 섬
export default function LoginButton({ className, panelOpen = false }) {
  const { user, logout } = useAuth();
  const [toast, setToast] = useState(false); // [로그아웃]을 누르면 화면 한가운데에 잠깐 띄우는 '로그아웃되었습니다' 알림
  const [selfRef, shiftStyle] = usePanelOffset(panelOpen && Boolean(user), NARROW_STYLE);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(false), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const onLogout = () => {
    logout();
    setToast(true);
  };

  let button = null; // 서버에 확인 중(user === undefined)이면 버튼 없음
  if (user) {
    button = (
      <div
        ref={selfRef}
        style={shiftStyle}
        className={`flex items-center gap-2 rounded-lg bg-background/95 py-1 pr-1 pl-3 text-sm shadow ${className ?? ""}`}
      >
        <span className="font-medium">{user.nickname}님</span>
        <Button variant="outline" size="sm" onClick={onLogout}>로그아웃</Button>
      </div>
    );
  } else if (user === null) {
    button = <Button className={`shadow ${className ?? ""}`} onClick={() => requireLogin()}>로그인</Button>;
  }

  return (
    <>
      {button}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-foreground/85 px-8 py-5 text-base font-semibold whitespace-nowrap text-background shadow-xl animate-in fade-in zoom-in-95"
        >
          로그아웃되었습니다
        </div>
      )}
    </>
  );
}
