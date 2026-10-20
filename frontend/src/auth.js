import { useEffect, useState } from "react";

// 브라우저 저장 이름
export const TOKEN_KEY = "auth_token";
export const NICKNAME_KEY = "auth_nickname";

const SERVER_DOWN = "서버에 연결하지 못했습니다. 백엔드 서버(포트 8001)가 켜져 있는지 확인해 주세요.";

const FIELD_NAMES = { nickname: "닉네임", user_id: "아이디", password: "비밀번호" };

function readStored() {
  const token = localStorage.getItem(TOKEN_KEY);
  const nickname = localStorage.getItem(NICKNAME_KEY);
  return token && nickname ? { token, nickname } : null;
}

function saveStored({ token, nickname }) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(NICKNAME_KEY, nickname);
}

function clearStored() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(NICKNAME_KEY);
}

// 서버가 보낸 detail을 화면에 보일 문장으로 바꿈 (422는 칸별 오류 목록으로 옴)
function errorMessage(detail) {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        const field = FIELD_NAMES[d.loc?.[d.loc.length - 1]];
        const msg = String(d.msg ?? "").replace(/^Value error, /, "");
        return field ? `${field}: ${msg}` : msg;
      })
      .join("\n");
  }
  return "요청을 처리하지 못했습니다.";
}

// /api/auth/* 호출. 실패하면 { status, message } 를 담은 Error를 던짐 (status 0 = 서버에 닿지 못함)
async function request(path, { token, body, method = "POST" } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`/api/auth/${path}`, { method, headers, body: body && JSON.stringify(body) });
  } catch {
    throw Object.assign(new Error(SERVER_DOWN), { status: 0 });
  }
  const data = await res.json().catch(() => null);
  if (res.ok) return data;
  // 서버가 꺼져 있으면 Vite 프록시가 JSON 없이 5xx를 돌려줌
  if (res.status >= 500 || !data) throw Object.assign(new Error(SERVER_DOWN), { status: res.status });
  throw Object.assign(new Error(errorMessage(data.detail)), { status: res.status });
}

export const signup = (form) => request("signup", { body: form });
export const login = (form) => request("login", { body: form });

// 로그인 상태: { nickname } 또는 null. 새로고침하면 /me로 저장된 표가 아직 유효한지 확인
export function useAuth() {
  const [user, setUser] = useState(() => {
    const stored = readStored();
    return stored && { nickname: stored.nickname };
  });

  useEffect(() => {
    const stored = readStored();
    if (!stored) return;
    request("me", { method: "GET", token: stored.token })
      .then((me) => {
        localStorage.setItem(NICKNAME_KEY, me.nickname);
        setUser({ nickname: me.nickname });
      })
      .catch((err) => {
        // 401(서버 재시작 등으로 표가 사라짐)일 때만 지움. 서버가 꺼져 있으면 그대로 둠
        if (err.status === 401) {
          clearStored();
          setUser(null);
        }
      });
  }, []);

  // login/signup 이 돌려준 { token, nickname } 을 기억
  const remember = (result) => {
    saveStored(result);
    setUser({ nickname: result.nickname });
  };

  // 서버 응답과 관계없이 브라우저에서는 지움
  const logout = async () => {
    const stored = readStored();
    clearStored();
    setUser(null);
    if (stored) await request("logout", { token: stored.token }).catch(() => {});
  };

  return { user, remember, logout };
}
