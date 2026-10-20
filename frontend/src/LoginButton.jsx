import { useState } from "react";
import { Button } from "@/components/ui/button";
import LoginDialog from "./LoginDialog.jsx";
import { useAuth } from "./auth.js";
import usePanelOffset from "./usePanelOffset.js";

// 좁은 화면: 패널 위 [✕] 버튼(오른쪽 10px, 폭 34px) 바로 왼쪽에 띄움
const NARROW_STYLE = { right: 52, top: 10, zIndex: 30 };

// 시험용 로그인 버튼. 로그인 전에는 [로그인]으로 창을 열고, 로그인 뒤에는 닉네임과 [로그아웃]을 보여 줌
// panelOpen: 오른쪽 후기 패널이 열렸는지. 열리면 패널 왼쪽 옆으로 비켜 섬
export default function LoginButton({ className, panelOpen = false }) {
  const { user, remember, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [selfRef, shiftStyle] = usePanelOffset(panelOpen && Boolean(user), NARROW_STYLE);

  if (user) {
    return (
      <div
        ref={selfRef}
        style={shiftStyle}
        className={`flex items-center gap-2 rounded-lg bg-background/95 py-1 pr-1 pl-3 text-sm shadow ${className ?? ""}`}
      >
        <span className="font-medium">{user.nickname}님</span>
        <Button variant="outline" size="sm" onClick={logout}>로그아웃</Button>
      </div>
    );
  }

  return (
    <>
      <Button className={`shadow ${className ?? ""}`} onClick={() => setOpen(true)}>로그인</Button>
      <LoginDialog
        open={open}
        onOpenChange={setOpen}
        onSuccess={(result) => {
          remember(result);
          setOpen(false);
        }}
      />
    </>
  );
}
