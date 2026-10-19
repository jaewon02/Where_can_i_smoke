import { useEffect, useState } from "react";

const KEY = import.meta.env.VITE_KAKAO_JS_KEY;

// 카카오맵 SDK를 한 번만 로드
export function loadKakao() {
  return new Promise((resolve, reject) => {
    if (window.kakao?.maps) return window.kakao.maps.load(() => resolve(window.kakao));
    if (!KEY) return reject(new Error("VITE_KAKAO_JS_KEY가 설정되지 않았습니다 (frontend/.env)"));
    const s = document.createElement("script");
    s.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${KEY}&autoload=false&libraries=services`;
    s.onload = () => window.kakao.maps.load(() => resolve(window.kakao));
    s.onerror = () => reject(new Error("카카오맵 SDK 로드 실패 (키/등록 도메인 확인)"));
    document.head.appendChild(s);
  });
}

export function useKakao() {
  const [kakao, setKakao] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    loadKakao().then(setKakao).catch(setError);
  }, []);
  return { kakao, error };
}
