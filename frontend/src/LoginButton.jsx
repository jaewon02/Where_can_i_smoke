import { Button } from "@/components/ui/button";
import { requireLogin, useAuth } from "./auth.js";

// 시험용 로그인 버튼. 로그인 전에는 [로그인]으로 창을 열고, 로그인 뒤에는 닉네임과 [로그아웃]을 보여 줌
export default function LoginButton({ className }) {
  const { user, logout } = useAuth();

  if (user === undefined) return null; // 서버에 확인 중
  if (user) {
    return (
      <div className={`flex items-center gap-2 rounded-lg bg-background/95 py-1 pr-1 pl-3 text-sm shadow ${className ?? ""}`}>
        <span className="font-medium">{user.nickname}님</span>
        <Button variant="outline" size="sm" onClick={logout}>로그아웃</Button>
      </div>
    );
  }

  return <Button className={`shadow ${className ?? ""}`} onClick={() => requireLogin()}>로그인</Button>;
}
