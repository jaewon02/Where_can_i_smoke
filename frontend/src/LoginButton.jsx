import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import LoginDialog from "./LoginDialog.jsx";
import { useAuth } from "./auth.js";

const TOAST_MS = 2000; // 로그아웃 알림이 떠 있는 시간

// 시험용 로그인 버튼. 로그인 전에는 [로그인]으로 창을 열고, 로그인 뒤에는 닉네임과 [로그아웃]을 보여 줌
export default function LoginButton({ className }) {
  const { user, remember, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(false); // [로그아웃]을 누르면 화면 한가운데에 잠깐 띄우는 '로그아웃되었습니다' 알림

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(false), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const onLogout = () => {
    logout();
    setToast(true);
  };

  return (
    <>
      {user ? (
        <div className={`flex items-center gap-2 rounded-lg bg-background/95 py-1 pr-1 pl-3 text-sm shadow ${className ?? ""}`}>
          <span className="font-medium">{user.nickname}님</span>
          <Button variant="outline" size="sm" onClick={onLogout}>로그아웃</Button>
        </div>
      ) : (
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
      )}
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
