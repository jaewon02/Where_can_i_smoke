import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { login, signup } from "./auth.js";

const FIELDS = {
  login: [
    { name: "user_id", label: "아이디", autoComplete: "username" },
    { name: "password", label: "비밀번호", type: "password", autoComplete: "current-password" },
  ],
  signup: [
    { name: "nickname", label: "닉네임", autoComplete: "nickname", hint: "1~20자" },
    { name: "user_id", label: "아이디", autoComplete: "username", hint: "영문 소문자·숫자·_ 4~20자" },
    { name: "password", label: "비밀번호", type: "password", autoComplete: "new-password", hint: "8~64자" },
  ],
};

// 로그인/회원가입 입력 양식 하나. 성공하면 서버 응답({ token, nickname, ... })을 onSuccess로 넘김
function AuthForm({ mode, pending, setPending, onSuccess }) {
  const fields = FIELDS[mode];
  const [form, setForm] = useState(() => Object.fromEntries(fields.map((f) => [f.name, ""])));
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      const result = await (mode === "login" ? login(form) : signup(form));
      onSuccess(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  const action = mode === "login" ? "로그인" : "회원가입";

  return (
    <form onSubmit={submit} className="grid gap-3 pt-2">
      {fields.map((f) => (
        <div key={f.name} className="grid gap-1.5">
          <Label htmlFor={`${mode}-${f.name}`}>{f.label}</Label>
          <Input
            id={`${mode}-${f.name}`}
            type={f.type ?? "text"}
            autoComplete={f.autoComplete}
            required
            disabled={pending}
            value={form[f.name]}
            onChange={(e) => setForm((v) => ({ ...v, [f.name]: e.target.value }))}
          />
          {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
        </div>
      ))}
      {error && (
        <p role="alert" className="whitespace-pre-line rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="mt-1 w-full" disabled={pending}>
        {pending && <Loader2Icon className="animate-spin" />}
        {pending ? `${action} 중…` : action}
      </Button>
    </form>
  );
}

// 지도 위에 뜨는 로그인 창. [로그인] [회원가입] 탭
export default function LoginDialog({ open, onOpenChange, onSuccess }) {
  const [tab, setTab] = useState("login");
  const [pending, setPending] = useState(false);

  return (
    // 서버 응답을 기다리는 동안에는 닫히지 않게 함
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{tab === "login" ? "로그인" : "회원가입"}</DialogTitle>
          <DialogDescription>아이디와 비밀번호로 로그인해요.</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => !pending && setTab(v)}>
          <TabsList className="w-full">
            <TabsTrigger value="login" disabled={pending}>로그인</TabsTrigger>
            <TabsTrigger value="signup" disabled={pending}>회원가입</TabsTrigger>
          </TabsList>
          {/* 창을 닫으면 내용이 사라지므로 다시 열 때 입력값과 오류가 비워짐 */}
          <TabsContent value="login">
            <AuthForm mode="login" pending={pending} setPending={setPending} onSuccess={onSuccess} />
          </TabsContent>
          <TabsContent value="signup">
            <AuthForm mode="signup" pending={pending} setPending={setPending} onSuccess={onSuccess} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
