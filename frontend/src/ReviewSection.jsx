import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "./auth.js";
import { createReview, deleteReview, listReviews } from "./reviews.js";

const CONTENT_MAX = 500;
// 일반 장소는 카카오 장소 번호(숫자)만 후기를 받음. 버스정류장('bus-…')처럼 숫자가 아닌 번호는 서버도 거절함
const PLACE_ID_RE = /^[0-9]{1,20}$/;

// 쓰던 글 (대상별). 로그인이 만료돼 패널이 닫혔다가 다시 열려도 남아 있게 부품 밖에 보관
const drafts = new Map();

// 후기 쓰기 + 목록. 흡연구역(targetType "zone", zones.id)과 일반 장소("place", 카카오 장소 번호) 모두 받음
// onAuthExpired: 쓰기·지우기가 401이면 부름 (로그인 창을 다시 띄우는 쪽에서 처리)
export default function ReviewSection({ targetType, targetId, name, address, onAuthExpired }) {
  const { user, logout } = useAuth();
  const key = `${targetType}:${targetId}`;
  const supported = targetType !== "place" || PLACE_ID_RE.test(targetId);
  const [list, setList] = useState({ status: "loading", items: [], message: "" });
  const [rating, setRating] = useState(() => drafts.get(key)?.rating ?? 0);
  const [content, setContent] = useState(() => drafts.get(key)?.content ?? "");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(""); // 입력 오류 (보내기 전 검사 또는 422)
  const [saveError, setSaveError] = useState(""); // 저장 실패
  const [deletingId, setDeletingId] = useState(null);
  const [deleteErrors, setDeleteErrors] = useState({}); // 후기 번호 -> 삭제 실패 문장

  const load = useCallback(() => {
    if (!supported) return; // 후기를 받지 않는 장소는 서버를 부르지 않음
    let cancelled = false;
    setList((l) => ({ ...l, status: "loading", message: "" }));
    listReviews(targetType, targetId)
      .then((items) => !cancelled && setList({ status: "ok", items, message: "" }))
      .catch((err) => !cancelled && setList({ status: "error", items: [], message: err.message }));
    return () => (cancelled = true);
  }, [targetType, targetId, supported]);

  useEffect(() => load(), [load]);

  // 대상이 바뀌면 부르는 쪽에서 key로 새로 그림 (ZonePanel 참고). 그래서 여기서는 쓰던 글 저장만
  useEffect(() => {
    if (rating || content) drafts.set(key, { rating, content });
    else drafts.delete(key);
  }, [key, rating, content]);

  // 로그인 표가 사라졌으면 브라우저의 로그인 기억을 지우고 로그인 창을 다시 띄움
  const expire = () => {
    onAuthExpired?.();
    logout();
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaveError("");
    const text = content.trim();
    if (!rating) return setFormError("별점을 골라 주세요.");
    if (!text) return setFormError("후기 내용을 입력해 주세요.");
    if (text.length > CONTENT_MAX) return setFormError(`후기 내용은 앞뒤 공백을 빼고 ${CONTENT_MAX}자 이하여야 합니다.`);
    setFormError("");
    setSaving(true);
    try {
      const review = await createReview({ targetType, targetId, rating, content: text });
      setList((l) => ({ status: "ok", items: [review, ...l.items], message: "" }));
      setRating(0);
      setContent("");
    } catch (err) {
      if (err.status === 401) return expire();
      if (err.status === 422) setFormError(err.message);
      else setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    setDeletingId(id);
    setDeleteErrors(({ [id]: _, ...rest }) => rest);
    try {
      await deleteReview(id);
      setList((l) => ({ ...l, items: l.items.filter((r) => r.id !== id) }));
    } catch (err) {
      if (err.status === 401) return expire();
      setDeleteErrors((m) => ({ ...m, [id]: err.message }));
    } finally {
      setDeletingId(null);
    }
  };

  const length = content.trim().length;

  if (!supported) {
    return (
      <section aria-label={`${name} 후기`} className="mt-5 flex flex-col gap-5">
        <h3 className="text-base font-bold">후기</h3>
        <p className="muted">이 장소는 아직 후기를 쓸 수 없어요.</p>
      </section>
    );
  }

  return (
    <section aria-label={`${name} 후기`} className="mt-5 flex flex-col gap-5">
      <h3 className="text-base font-bold">후기</h3>

      <form onSubmit={submit} className="flex flex-col gap-2 rounded-lg border p-3" aria-label="후기 쓰기">
        <div role="radiogroup" aria-label="별점" className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`별점 ${n}점`}
              disabled={saving}
              onClick={() => {
                setRating(n);
                setFormError("");
              }}
              className={`cursor-pointer px-0.5 text-2xl leading-none ${n <= rating ? "text-amber-400" : "text-gray-300"}`}
            >
              ★
            </button>
          ))}
          <span className="ml-2 text-sm text-gray-500">{rating ? `${rating}점` : "별점을 골라 주세요"}</span>
        </div>
        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setFormError("");
          }}
          disabled={saving}
          rows={4}
          placeholder={address ? `${name} (${address}) 어땠나요?` : `${name} 어땠나요?`}
          aria-label="후기 내용"
          aria-invalid={!!formError}
          className="w-full resize-y rounded-md border px-2.5 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
        />
        <div className="flex items-center justify-between gap-2">
          <span className={`text-xs ${length > CONTENT_MAX ? "text-destructive" : "text-gray-500"}`}>
            {length}/{CONTENT_MAX}
          </span>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "저장 중…" : "등록"}
          </Button>
        </div>
        {formError && <p role="alert" className="text-sm whitespace-pre-line text-destructive">{formError}</p>}
        {saveError && <p role="alert" className="text-sm whitespace-pre-line text-destructive">저장하지 못했어요. {saveError}</p>}
      </form>

      <div aria-live="polite">
        {list.status === "loading" && <p className="muted">후기를 불러오는 중…</p>}
        {list.status === "error" && (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm whitespace-pre-line text-destructive">후기를 불러오지 못했어요. {list.message}</p>
            <Button variant="outline" size="sm" onClick={load}>다시 시도</Button>
          </div>
        )}
        {list.status === "ok" && list.items.length === 0 && <p className="muted">아직 등록된 후기가 없어요.</p>}
        {list.status === "ok" && list.items.length > 0 && (
          <ul className="flex flex-col divide-y">
            {list.items.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex items-center gap-2 text-sm">
                  <b>{r.nickname}</b>
                  <span className="text-amber-400" aria-label={`별점 ${r.rating}점`}>
                    {"★".repeat(r.rating)}
                    <span className="text-gray-300">{"★".repeat(5 - r.rating)}</span>
                  </span>
                  <span className="ml-auto text-xs text-gray-500">{r.created_at.slice(0, 16)}</span>
                </div>
                <p className="mt-1 text-sm break-words whitespace-pre-line">{r.content}</p>
                {user && r.nickname === user.nickname && (
                  <div className="mt-1 flex items-center justify-end gap-2">
                    {deleteErrors[r.id] && <span className="text-xs text-destructive">{deleteErrors[r.id]}</span>}
                    <Button variant="ghost" size="xs" disabled={deletingId === r.id} onClick={() => remove(r.id)}>
                      {deletingId === r.id ? "삭제 중…" : "삭제"}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
