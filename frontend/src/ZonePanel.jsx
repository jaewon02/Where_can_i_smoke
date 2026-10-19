import { useEffect, useRef, useState } from "react";
import RouteButtons from "./RouteButtons.jsx";

const MAX_PHOTOS = 4;
const MAX_PHOTO_MB = 5;
const TYPE_LABEL = { smoking: "흡연구역", nonsmoking: "비흡연구역" };

function Stars({ value, size = 16 }) {
  return (
    <span className="stars" role="img" aria-label={`별점 ${value}점`} style={{ fontSize: size }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= Math.round(value) ? "on" : ""}>★</span>
      ))}
    </span>
  );
}

function StarInput({ value, onChange }) {
  return (
    <div className="star-input" role="radiogroup" aria-label="별점">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          type="button"
          key={n}
          role="radio"
          aria-checked={value === n}
          aria-label={`${n}점`}
          className={n <= value ? "on" : ""}
          onClick={() => onChange(n)}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export default function ZonePanel({ zoneId, onClose, onRoutePick }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const closeRef = useRef(null);

  const load = async () => {
    try {
      const res = await fetch(`/api/zones/${zoneId}`);
      if (!res.ok) throw new Error("정보를 불러오지 못했습니다");
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    setData(null);
    setLightbox(null);
    load();
    closeRef.current?.focus();
  }, [zoneId]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (lightbox) setLightbox(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, onClose]);

  const zone = data?.zone;
  const allPhotos = data ? data.reviews.flatMap((r) => r.photos) : [];

  return (
    <aside className="panel" role="dialog" aria-label={zone?.name ?? "구역 상세"}>
      <button ref={closeRef} className="panel-close" onClick={onClose} aria-label="닫기">
        ✕
      </button>

      {error && <p className="panel-msg error-text">{error}</p>}
      {!data && !error && <p className="panel-msg">불러오는 중…</p>}

      {zone && (
        <div className="panel-body">
          <header className="panel-head">
            <span className={`badge ${zone.type}`}>{TYPE_LABEL[zone.type]}</span>
            <h2>{zone.name}</h2>
            <p className="addr">{zone.address}</p>
            {zone.note && <p className="note">{zone.note}</p>}
            {zone.radius_m && <p className="note">금연 반경 약 {zone.radius_m}m</p>}
            <div className="summary">
              {data.avg_rating ? (
                <>
                  <b>{data.avg_rating}</b>
                  <Stars value={data.avg_rating} size={18} />
                  <span className="muted">후기 {data.review_count}개</span>
                </>
              ) : (
                <span className="muted">아직 후기가 없어요</span>
              )}
            </div>
            <RouteButtons place={zone} onPick={onRoutePick} className="panel-od" />
          </header>

          {allPhotos.length > 0 && (
            <section aria-label="사진">
              <h3>사진 {allPhotos.length}</h3>
              <div className="gallery">
                {allPhotos.slice(0, 6).map((src, i) => (
                  <button key={src} className="thumb" onClick={() => setLightbox(src)} aria-label={`사진 ${i + 1} 크게 보기`}>
                    <img src={src} alt="" loading="lazy" />
                    {i === 5 && allPhotos.length > 6 && <span className="more">+{allPhotos.length - 6}</span>}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section aria-label="후기">
            <h3>후기</h3>
            {data.reviews.length === 0 && <p className="muted">첫 후기를 남겨 보세요.</p>}
            <ul className="reviews">
              {data.reviews.map((r) => (
                <li key={r.id}>
                  <div className="r-top">
                    <b>{r.author}</b>
                    <Stars value={r.rating} />
                    <time className="muted">{r.created_at.slice(0, 10)}</time>
                  </div>
                  <p>{r.content}</p>
                  {r.photos.length > 0 && (
                    <div className="r-photos">
                      {r.photos.map((src) => (
                        <button key={src} className="thumb small" onClick={() => setLightbox(src)} aria-label="사진 크게 보기">
                          <img src={src} alt="" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <ReviewForm zoneId={zoneId} onSaved={load} />
        </div>
      )}

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="사진 크게 보기">
          <img src={lightbox} alt="후기 사진" />
          <button className="lightbox-close" aria-label="닫기">✕</button>
        </div>
      )}
    </aside>
  );
}

function ReviewForm({ zoneId, onSaved }) {
  const [author, setAuthor] = useState(() => {
    try {
      return localStorage.getItem("nickname") ?? "";
    } catch {
      return "";
    }
  });
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);

  // 미리보기 주소는 파일이 바뀔 때마다 만들고, 정리 시 해제
  const [previews, setPreviews] = useState([]);
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  const pickFiles = (e) => {
    const picked = [...e.target.files];
    e.target.value = "";
    const tooBig = picked.find((f) => f.size > MAX_PHOTO_MB * 1024 * 1024);
    if (tooBig) return setMsg({ ok: false, text: `사진 한 장은 ${MAX_PHOTO_MB}MB 이하여야 해요` });
    const next = [...files, ...picked];
    if (next.length > MAX_PHOTOS) setMsg({ ok: false, text: `사진은 최대 ${MAX_PHOTOS}장까지 올릴 수 있어요` });
    else setMsg(null);
    setFiles(next.slice(0, MAX_PHOTOS));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("author", author.trim());
      fd.append("rating", rating);
      fd.append("content", content.trim());
      files.forEach((f) => fd.append("photos", f));
      const res = await fetch(`/api/zones/${zoneId}/reviews`, { method: "POST", body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.detail === "string" ? body.detail : "입력 내용을 확인해 주세요");
      }
      try {
        localStorage.setItem("nickname", author.trim());
      } catch {
        /* 저장 실패는 무시 */
      }
      setContent("");
      setFiles([]);
      setRating(5);
      setMsg({ ok: true, text: "후기가 등록되었어요" });
      await onSaved();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="review-form" onSubmit={submit}>
      <h3>후기 남기기</h3>
      <div className="row">
        <input
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          placeholder="닉네임"
          maxLength={20}
          required
          aria-label="닉네임"
        />
        <StarInput value={rating} onChange={setRating} />
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="이곳은 어땠나요? (환기, 청결, 위치 등)"
        maxLength={500}
        rows={3}
        required
        aria-label="후기 내용"
      />
      <div className="row">
        <button type="button" className="btn ghost" onClick={() => fileRef.current?.click()} disabled={files.length >= MAX_PHOTOS}>
          📷 사진 추가 ({files.length}/{MAX_PHOTOS})
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={pickFiles} />
        <span className="muted count">{content.length}/500</span>
      </div>
      {previews.length > 0 && (
        <div className="r-photos">
          {previews.map((src, i) => (
            <div key={src} className="thumb small preview">
              <img src={src} alt="" />
              <button
                type="button"
                className="remove"
                aria-label="사진 삭제"
                onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      {msg && (
        <p className={msg.ok ? "form-msg ok" : "form-msg error-text"} role="status">
          {msg.text}
        </p>
      )}
      <button className="btn primary" disabled={busy}>
        {busy ? "등록 중…" : "등록"}
      </button>
    </form>
  );
}
