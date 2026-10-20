import { useEffect, useSyncExternalStore } from "react";

// 브라우저에는 로그인 표(token)만 저장. 로그인했는지·누구인지는 항상 서버(/me, 로그인 응답)가 정함
const TOKEN_KEY = "auth_token";

const SERVER_DOWN = "서버에 연결하지 못했습니다. 백엔드 서버(포트 8001)가 켜져 있는지 확인해 주세요.";

const FIELD_NAMES = { nickname: "닉네임", user_id: "아이디", password: "비밀번호" };

// 앱 전체에서 하나뿐인 로그인 상태. undefined = 서버에 확인 중, null = 로그인 안 함, { nickname, user_id }
let currentUser;
// 앱 전체에서 하나뿐인 로그인 창. 열려 있는 동안 requireLogin()을 부른 곳이 결과(사용자 또는 null)를 기다림
let loginOpen = false;
let loginDone = null;
const listeners = new Set();
const subscribe = (listener) => (listeners.add(listener), () => listeners.delete(listener));
const emit = () => listeners.forEach((listener) => listener());
function setUser(user) {
  currentUser = user;
  emit();
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

// 성공하면 서버가 준 표와 사용자 정보를 기억하고 로그인 창을 닫음
export const signup = (form) => request("signup", { body: form }).then(remember);
export const login = (form) => request("login", { body: form }).then(remember);

// 저장된 표로 서버(/me)에 지금 누구인지 물어 로그인 상태를 정함
async function refresh() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return setUser(null);
  try {
    const me = await request("me", { method: "GET", token });
    // 기다리는 동안 로그인/로그아웃했으면 이 응답은 버림
    if (localStorage.getItem(TOKEN_KEY) === token) setUser({ nickname: me.nickname, user_id: me.user_id });
  } catch (err) {
    if (localStorage.getItem(TOKEN_KEY) !== token) return;
    // 401(서버 재시작 등으로 표가 사라짐)이면 표를 지움. 서버가 꺼져 있으면 표는 두고 로그인 안 된 것으로 봄
    if (err.status === 401) localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }
}

// login/signup 이 돌려준 { token, nickname, user_id } 를 기억
function remember(result) {
  localStorage.setItem(TOKEN_KEY, result.token);
  setUser({ nickname: result.nickname, user_id: result.user_id });
  closeLogin(currentUser);
}

function closeLogin(user) {
  loginOpen = false;
  emit();
  loginDone?.(user);
  loginDone = null;
}

// 로그인하지 않고 로그인 창을 닫음
export const cancelLogin = () => closeLogin(null);
export const useLoginOpen = () => useSyncExternalStore(subscribe, () => loginOpen);

// 서버(/me)에 로그인 상태를 확인하고, 로그인 전이면 로그인 창을 띄움. 로그인하면 사용자, 그냥 닫으면 null
export async function requireLogin() {
  await refresh();
  if (currentUser) return currentUser;
  return new Promise((resolve) => {
    loginDone?.(null); // 앞서 기다리던 곳이 있으면 취소로 끝냄
    loginDone = resolve;
    loginOpen = true;
    emit();
  });
}

// 서버 응답과 관계없이 브라우저에서는 지움
async function logout() {
  const token = localStorage.getItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
  setUser(null);
  if (token) await request("logout", { token }).catch(() => {});
}

// 로그인 상태: undefined(확인 중) / null / { nickname, user_id }. 쓰는 화면이 나타날 때마다 서버에 다시 확인
export function useAuth() {
  const user = useSyncExternalStore(subscribe, () => currentUser);
  useEffect(() => {
    refresh();
  }, []);
  return { user, logout };
}
