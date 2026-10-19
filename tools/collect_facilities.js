// 송파구 금연 규칙 대상 시설 수집기 (브라우저 콘솔용)
//
// 카카오 장소 검색은 한 번에 최대 45개까지만 주기 때문에, 송파구 전체를 격자로 나눠 시설 종류마다 검색하고
// 결과가 45개로 꽉 찬 칸은 4등분해서 다시 검색합니다. 모은 시설은 백엔드 DB(facilities)에 저장합니다.
//
// 사용법
//   1. 백엔드를 수집 허용 모드로 실행:  ALLOW_DEV_INGEST=1 uvicorn main:app --port 8001   (PowerShell: $env:ALLOW_DEV_INGEST=1)
//   2. 프런트엔드를 켜고 지도 페이지(http://localhost:5174)를 연 뒤, 개발자도구 콘솔에 이 파일 내용을 붙여넣기
//      (수집하는 동안 페이지를 새로고침하거나 프런트엔드 파일을 수정하면 중단됩니다)
//   3. 진행 상황: window.__ing  (finished: true 가 되면 끝)
//   4. 끝나면 `python facilities_tool.py export` 로 data/facilities_songpa.json 갱신, 백엔드는 수집 모드 없이 다시 실행
//
// 시설 종류와 조건은 frontend/src/facilities.js 의 FACILITY_TYPES 를 그대로 사용합니다.

const m = await import('/src/facilities.js');
const types = m.FACILITY_TYPES.filter((t) => t.collect !== false && t.keyword); // 검색으로 모으지 않는 종류(지하철 출입구 등)는 제외
const S = kakao.maps.services;
const st = (window.__ing = { queued: 0, done: 0, found: 0, sent: 0, saturatedAtMaxDepth: 0, errors: 0, finished: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function search(keyword, b) {
  return new Promise((res) => {
    const all = [];
    new S.Places().keywordSearch(
      keyword,
      (d, s, pg) => {
        if (s !== S.Status.OK) {
          if (s === S.Status.ERROR) st.errors++;
          return res(all);
        }
        all.push(...d);
        if (pg.hasNextPage && pg.current < 3) pg.nextPage();
        else res(all);
      },
      { bounds: b, size: 15 }
    );
  });
}
const rect = (s, w, n, e) => new kakao.maps.LatLngBounds(new kakao.maps.LatLng(s, w), new kakao.maps.LatLng(n, e));

// 송파구 전체를 덮는 영역 (남, 북, 서, 동)과 격자 크기
const S0 = 37.455, N0 = 37.545, W0 = 127.07, E0 = 127.19, DLAT = 0.012, DLNG = 0.015;
const queue = [];
for (const t of types)
  for (let la = S0; la < N0; la += DLAT)
    for (let ln = W0; ln < E0; ln += DLNG) queue.push({ t, s: la, w: ln, n: la + DLAT, e: ln + DLNG, depth: 0 });
st.queued = queue.length;

const found = new Map();
let pending = [];
async function flush(force) {
  if (pending.length < 300 && !force) return;
  const batch = pending;
  pending = [];
  if (!batch.length) return;
  const r = await fetch('/api/dev/facilities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(batch) });
  if (r.ok) st.sent += batch.length;
  else st.errors++;
}

async function worker() {
  while (queue.length) {
    const task = queue.pop();
    const raw = await search(task.t.keyword, rect(task.s, task.w, task.n, task.e));
    if (raw.length >= 45) {
      // 결과가 꽉 찼으면 일부가 잘렸을 수 있으므로 4등분해서 다시 검색
      if (task.depth < 4) {
        const ms = (task.s + task.n) / 2, mw = (task.w + task.e) / 2;
        for (const [s, w, n, e] of [[task.s, task.w, ms, mw], [task.s, mw, ms, task.e], [ms, task.w, task.n, mw], [ms, mw, task.n, task.e]])
          queue.push({ t: task.t, s, w, n, e, depth: task.depth + 1 });
        st.queued += 4;
        st.done++;
        continue;
      }
      st.saturatedAtMaxDepth++;
    }
    for (const p of raw) {
      if (!task.t.match(p) || found.has(p.id)) continue;
      if (!(p.road_address_name || p.address_name || '').includes('송파구')) continue; // 이웃 구 시설 제외
      const item = { kakao_id: p.id, type_key: task.t.key, name: p.place_name, lat: +p.y, lng: +p.x };
      found.set(p.id, item);
      pending.push(item);
      st.found++;
    }
    st.done++;
    await flush(false);
    await sleep(30);
  }
}
(async () => {
  await Promise.all([worker(), worker(), worker()]);
  await flush(true);
  st.finished = true;
})();
