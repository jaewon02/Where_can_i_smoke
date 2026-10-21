import { getToken } from "./auth.js";

// 후기 서버 호출 (/api/reviews). 실패하면 { status, message } 를 담은 Error를 던짐 (status 0 = 서버에 닿지 못함)

const SERVER_DOWN = "서버에 연결하지 못했습니다. 백엔드 서버(포트 8001)가 켜져 있는지 확인해 주세요.";

// 서버가 보낸 detail을 화면에 보일 문장으로 바꿈 (422 본문 검사는 오류 목록으로 옴)
function errorMessage(detail) {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d) => String(d.msg ?? "").replace(/^Value error, /, "")).join("\n");
  return "요청을 처리하지 못했습니다.";
}

async function request(path, { method = "GET", body, auth = false } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(`/api/reviews${path}`, { method, headers, body: body && JSON.stringify(body) });
  } catch {
    throw Object.assign(new Error(SERVER_DOWN), { status: 0 });
  }
  const data = await res.json().catch(() => null);
  if (res.ok) return data;
  // 서버가 꺼져 있으면 Vite 프록시가 JSON 없이 5xx를 돌려줌 (후기 표가 없을 때의 503은 detail이 있음)
  if (!data) throw Object.assign(new Error(SERVER_DOWN), { status: res.status });
  throw Object.assign(new Error(errorMessage(data.detail)), { status: res.status });
}

// targetType: "place"(일반 장소) | "building"(건물), targetId: 글자 번호
// address: 도로명주소. 건물은 이 주소로 같은 건물의 후기를 모두 모아 옴
export const listReviews = (targetType, targetId, address) =>
  request(`?${new URLSearchParams({ target_type: targetType, target_id: targetId, address: address ?? "" })}`);

// 후기가 있는 장소·건물 (주소별로 묶음): [{ address, count, rating, target_id }]
export const listReviewedPlaces = () => request("/places");

export const createReview =({ targetType, targetId, address, rating, content }) =>
  request("", {
    method: "POST",
    auth: true,
    body: { target_type: targetType, target_id: targetId, address: address || null, rating, content },
  });

export const deleteReview = (id) => request(`/${id}`, { method: "DELETE", auth: true });
