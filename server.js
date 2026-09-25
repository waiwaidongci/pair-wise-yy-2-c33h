import http from "node:http";
import { loadDb, saveDb } from "./src/store.js";
import { registerPrizeRace, settleRace, cancelRace, markLinePaid, resolveRecovery } from "./src/prizes.js";

// 页面操作：档案登记页、奖金结算台页面与全部 HTTP 接口
const port = Number(process.env.PORT || 3024);

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("请求体不是合法 JSON");
    error.status = 400;
    throw error;
  }
}
function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
function relation(db, ringNo) {
  const pigeon = db.pigeons.find(item => item.ringNo === ringNo);
  if (!pigeon) return null;
  const father = db.pigeons.find(item => item.ringNo === pigeon.fatherRing) || null;
  const mother = db.pigeons.find(item => item.ringNo === pigeon.motherRing) || null;
  const children = db.pigeons.filter(item => item.fatherRing === ringNo || item.motherRing === ringNo);
  return { pigeon, father, mother, children };
}

const page = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>赛鸽血统环号登记站</title>
  <style>
    :root { --bg:#eff2f5; --panel:#fff; --ink:#1f2833; --muted:#697786; --line:#d3dce4; --accent:#315f83; --red:#9b3f35; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:#fff; border:1px solid var(--line); border-radius:8px; padding:16px; } h2 { margin:0 0 12px; font-size:18px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; }
    .toolbar { display:grid; grid-template-columns:1fr auto; gap:10px; margin-bottom:14px; } .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; }
    .card { display:grid; gap:8px; } .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .section { margin-top:14px; } .relation { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:14px; } .small { background:#f8fafb; border:1px solid var(--line); border-radius:8px; padding:10px; }
    .actions { display:flex; gap:8px; align-items:center; } .btn-link { display:inline-block; border:1px solid var(--accent); color:var(--accent); border-radius:6px; padding:9px 12px; text-decoration:none; font-weight:700; }
    .race-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; } .race-row button { padding:5px 9px; font-size:12px; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} .relation{grid-template-columns:1fr;} }
  </style>
</head>
<body>
  <header><div><h1>赛鸽血统环号登记站</h1><div class="meta">档案、血统、转让和归巢成绩</div></div><div class="actions"><a class="btn-link" href="/settlement">奖金结算台</a><button id="reload">刷新</button></div></header>
  <main>
    <form id="form">
      <h2>创建鸽只档案</h2>
      <label>足环号</label><input name="ringNo" required>
      <label>鸽主</label><input name="owner" required>
      <label>父鸽足环号</label><input name="fatherRing">
      <label>母鸽足环号</label><input name="motherRing">
      <label>羽色</label><input name="color" required>
      <label>出生棚号</label><input name="loft" required>
      <button>保存档案</button>
    </form>
    <section>
      <div class="toolbar"><input id="search" placeholder="输入足环号查询血统"><button id="searchBtn">查询</button></div>
      <div class="panel" id="detail"></div>
      <div class="section grid" id="cards"></div>
    </section>
  </main>
  <script>
    const form = document.querySelector("#form");
    const cards = document.querySelector("#cards");
    const detail = document.querySelector("#detail");
    const search = document.querySelector("#search");
    let pigeons = [];
    let currentRing = "";
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ "Content-Type":"application/json" } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "请求失败");
      return data;
    }
    function renderCards() {
      cards.innerHTML = pigeons.map(p => '<article class="card"><h3>'+p.ringNo+'</h3><span class="pill">'+p.owner+'</span><div class="meta">'+p.color+' · '+p.loft+'</div><div>父：'+(p.fatherRing || "未登记")+'</div><div>母：'+(p.motherRing || "未登记")+'</div><label>录入转让</label><input data-to="'+p.ringNo+'" placeholder="新归属人"><button data-transfer="'+p.ringNo+'">保存转让</button><label>归巢成绩</label><input data-race="'+p.ringNo+'" placeholder="赛事/距离/名次，如200公里/200/6"><button data-score="'+p.ringNo+'">保存成绩</button></article>').join("");
      document.querySelectorAll("[data-transfer]").forEach(btn => btn.onclick = async () => {
        const ringNo = btn.dataset.transfer; const to = document.querySelector('[data-to="'+ringNo+'"]').value;
        await api('/api/pigeons/'+encodeURIComponent(ringNo)+'/transfers', { method:'POST', body: JSON.stringify({ to }) }); await load();
      });
      document.querySelectorAll("[data-score]").forEach(btn => btn.onclick = async () => {
        const ringNo = btn.dataset.score; const raw = document.querySelector('[data-race="'+ringNo+'"]').value.split("/");
        await api('/api/pigeons/'+encodeURIComponent(ringNo)+'/races', { method:'POST', body: JSON.stringify({ event: raw[0] || "未命名赛事", distance: Number(raw[1] || 0), rank: Number(raw[2] || 0) }) }); await load();
      });
    }
    function renderRelation(data) {
      if (!data) { detail.innerHTML = '<h2>血统查询</h2><p class="meta">请输入足环号查看父母、子代、转让和成绩。</p>'; return; }
      const p = data.pigeon;
      currentRing = p.ringNo;
      const raceRows = p.races.map((r, i) => '<div class="small race-row"><span>'+r.date+' · '+r.event+' · 第'+r.rank+'名</span>'+(r.status === "cancelled" ? '<span class="pill">已取消</span>' : '<button data-correct="'+i+'">更正名次</button><button data-cancel="'+i+'">取消成绩</button>')+'</div>').join("");
      detail.innerHTML = '<h2>'+p.ringNo+' 血统档案</h2><div class="relation"><div class="small"><b>父鸽</b><br>'+(data.father?.ringNo || p.fatherRing || "未登记")+'</div><div class="small"><b>本鸽</b><br>'+p.owner+' · '+p.color+'</div><div class="small"><b>母鸽</b><br>'+(data.mother?.ringNo || p.motherRing || "未登记")+'</div></div><div><b>子代</b> '+(data.children.map(c => c.ringNo).join("、") || "暂无")+'</div><div class="meta">转让：'+(p.transfers.map(t => t.date+" "+t.from+"→"+t.to).join(" / ") || "暂无")+'</div><div class="section"><b>归巢成绩</b>'+(raceRows || '<div class="meta">暂无</div>')+'</div>';
      detail.querySelectorAll("[data-correct]").forEach(btn => btn.onclick = async () => {
        const rank = Number(prompt("更正后的名次"));
        if (!Number.isInteger(rank) || rank < 1) return;
        await api('/api/pigeons/'+encodeURIComponent(currentRing)+'/races/'+btn.dataset.correct+'/correct', { method:'POST', body: JSON.stringify({ rank }) });
        renderRelation(await api('/api/pigeons/'+encodeURIComponent(currentRing)+'/relation'));
      });
      detail.querySelectorAll("[data-cancel]").forEach(btn => btn.onclick = async () => {
        if (!confirm("确认取消该笔成绩？已结算的奖金会同步下架。")) return;
        await api('/api/pigeons/'+encodeURIComponent(currentRing)+'/races/'+btn.dataset.cancel+'/cancel', { method:'POST', body: "{}" });
        renderRelation(await api('/api/pigeons/'+encodeURIComponent(currentRing)+'/relation'));
      });
    }
    async function load(){ pigeons = await api("/api/pigeons"); renderCards(); renderRelation(null); }
    document.querySelector("#searchBtn").onclick = async () => renderRelation(await api('/api/pigeons/'+encodeURIComponent(search.value)+'/relation'));
    document.querySelector("#reload").onclick = load;
    form.onsubmit = async event => {
      event.preventDefault();
      await api("/api/pigeons", { method:"POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      form.reset(); await load();
    };
    load();
  </script>
</body>
</html>`;

const settlementPage = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>奖金结算台 · 赛鸽血统环号登记站</title>
  <style>
    :root { --bg:#eff2f5; --panel:#fff; --ink:#1f2833; --muted:#697786; --line:#d3dce4; --accent:#315f83; --red:#9b3f35; --green:#2f6f4f; --amber:#8a6d1c; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } main { display:grid; grid-template-columns:420px 1fr; gap:22px; padding:22px 28px; align-items:start; }
    form,.panel,.card { background:#fff; border:1px solid var(--line); border-radius:8px; padding:16px; } h2 { margin:0 0 12px; font-size:18px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; }
    button.danger { background:var(--red); }
    .col { display:grid; gap:14px; align-content:start; } .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:12px; }
    .card { display:grid; gap:8px; } .meta { color:var(--muted); font-size:13px; } .section { margin-top:12px; }
    .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .pill.red { color:var(--red); border-color:var(--red); } .pill.green { color:var(--green); border-color:var(--green); } .pill.amber { color:var(--amber); border-color:var(--amber); }
    table { width:100%; border-collapse:collapse; font-size:14px; } th,td { text-align:left; padding:7px 8px; border-bottom:1px solid var(--line); vertical-align:top; } th { color:var(--muted); font-weight:600; }
    .tablewrap { overflow-x:auto; } .actions { display:flex; gap:8px; align-items:center; }
    .btn-link { display:inline-block; border:1px solid var(--accent); color:var(--accent); border-radius:6px; padding:9px 12px; text-decoration:none; font-weight:700; }
    .small { background:#f8fafb; border:1px solid var(--line); border-radius:8px; padding:10px; margin-bottom:8px; }
    #toast { position:fixed; left:50%; bottom:24px; transform:translateX(-50%); background:var(--red); color:#fff; padding:10px 16px; border-radius:8px; display:none; max-width:80vw; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header>
    <div><h1>奖金结算台</h1><div class="meta">按足环、放飞日和名次生成应发奖金，收款人锁定比赛当天鸽主</div></div>
    <div class="actions"><a class="btn-link" href="/">档案登记</a><button id="reload">刷新</button></div>
  </header>
  <main>
    <div class="col">
      <form id="raceForm">
        <h2>登记赛事奖金</h2>
        <label>赛事名称</label><input name="event" required placeholder="如 300公里大奖赛">
        <label>放飞日</label><input name="releaseDate" type="date" required>
        <label>奖金表（每行一笔：名次 金额）</label><textarea name="prizes" rows="5" required placeholder="1 5000&#10;2 3000&#10;3 1000"></textarea>
        <div class="section"><button>登记奖金</button></div>
      </form>
      <div class="panel" id="settleResult" style="display:none"></div>
      <div class="panel"><h2>赛事奖金</h2><div class="grid" id="races"></div></div>
    </div>
    <div class="col">
      <div class="panel"><h2>每笔应收</h2><div class="tablewrap" id="lines"></div></div>
      <div class="panel"><h2>待追回</h2><div class="tablewrap" id="recoveries"></div></div>
      <div class="panel"><h2>异常记录</h2><div id="exceptions"></div></div>
      <div class="panel"><h2>结算留档</h2><div class="tablewrap" id="archive"></div></div>
    </div>
  </main>
  <div id="toast"></div>
  <script>
    const state = { prizeRaces: [], settlements: [], settlementArchive: [], recoveries: [], exceptions: [] };
    const typeNames = { duplicate_result: "重复成绩", no_prize_for_rank: "名次无奖金", transfer_after_race: "赛后转让", payee_locked: "收款人锁定" };
    const reasonNames = { result_corrected: "成绩更正", result_cancelled: "成绩取消", race_cancelled: "赛事取消" };
    const $ = sel => document.querySelector(sel);
    function esc(value) { return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }
    function toast(message) { const el = $("#toast"); el.textContent = message; el.style.display = "block"; setTimeout(() => { el.style.display = "none"; }, 3600); }
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers: { "Content-Type": "application/json" } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "请求失败");
      return data;
    }
    const guard = fn => async (...args) => { try { await fn(...args); } catch (error) { toast(error.message); } };
    function renderRaces() {
      $("#races").innerHTML = state.prizeRaces.length ? state.prizeRaces.map(race => {
        const prizes = race.prizes.map(p => "第" + p.rank + "名 " + p.amount + "元").join(" · ");
        const status = race.status === "cancelled" ? '<span class="pill red">已取消</span>' : (race.settleCount ? '<span class="pill green">已结算 ' + race.settleCount + " 次</span>" : '<span class="pill amber">待结算</span>');
        const actions = race.status === "cancelled" ? "" : '<div class="actions"><button data-settle="' + race.id + '">' + (race.settleCount ? "重新结算" : "结算") + '</button><button class="danger" data-cancelrace="' + race.id + '">取消赛事</button></div>';
        return '<article class="card"><h3>' + esc(race.event) + '</h3><div class="meta">放飞日 ' + esc(race.releaseDate) + " " + status + '</div><div>' + esc(prizes) + '</div>' + (race.settledAt ? '<div class="meta">最近结算 ' + esc(race.settledAt) + "</div>" : "") + actions + "</article>";
      }).join("") : '<p class="meta">尚未登记赛事奖金。</p>';
      document.querySelectorAll("[data-settle]").forEach(btn => btn.onclick = guard(async () => {
        showSummary(await api("/api/prize-races/" + btn.dataset.settle + "/settle", { method: "POST", body: "{}" }));
        await load();
      }));
      document.querySelectorAll("[data-cancelrace]").forEach(btn => btn.onclick = guard(async () => {
        if (!confirm("确认取消该赛事？全部应发将下架留档，已发放的生成待追回。")) return;
        await api("/api/prize-races/" + btn.dataset.cancelrace + "/cancel", { method: "POST", body: "{}" });
        await load();
      }));
    }
    function showSummary(s) {
      const el = $("#settleResult");
      el.style.display = "block";
      el.innerHTML = "<h2>结算结果 · " + esc(s.event) + "</h2><div class='meta'>新增应发 " + s.created.length + " 笔 · 未变 " + s.unchanged.length + " 笔 · 更正替换 " + s.replaced.length + " 笔 · 下架 " + s.revoked.length + " 笔 · 待追回 " + s.recoveries.length + " 笔 · 异常 " + s.exceptions.length + " 条</div>"
        + s.created.map(l => "<div>＋ " + esc(l.ringNo) + " 第" + l.rank + "名 " + l.amount + "元 → " + esc(l.payee) + "</div>").join("")
        + s.recoveries.map(r => "<div>↩ 待追回 " + esc(r.ringNo) + " " + esc(r.payee) + " " + r.amount + "元（" + esc(r.reason) + "）</div>").join("")
        + s.exceptions.map(e => "<div>⚠ " + esc(e.message) + "</div>").join("");
    }
    function renderLines() {
      const rows = [...state.settlements].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(l =>
        "<tr><td>" + esc(l.event) + "</td><td>" + esc(l.releaseDate) + "</td><td>" + esc(l.ringNo) + "</td><td>第" + l.rank + "名</td><td>" + l.amount + "元</td><td>" + esc(l.payee) + "</td><td>" + (l.status === "paid" ? '<span class="pill green">已发</span>' : '<span class="pill amber">待发</span>') + "</td><td>" + (l.status === "paid" ? "" : '<button data-pay="' + l.id + '">标记已发</button>') + "</td></tr>").join("");
      $("#lines").innerHTML = rows ? "<table><thead><tr><th>赛事</th><th>放飞日</th><th>足环</th><th>名次</th><th>金额</th><th>收款人</th><th>状态</th><th></th></tr></thead><tbody>" + rows + "</tbody></table>" : '<p class="meta">暂无应收奖金。</p>';
      document.querySelectorAll("[data-pay]").forEach(btn => btn.onclick = guard(async () => {
        await api("/api/settlements/" + encodeURIComponent(btn.dataset.pay) + "/pay", { method: "POST", body: "{}" });
        await load();
      }));
    }
    function renderRecoveries() {
      const rows = [...state.recoveries].reverse().map(r =>
        "<tr><td>" + esc(r.event) + "</td><td>" + esc(r.ringNo) + "</td><td>" + esc(r.payee) + "</td><td>" + r.amount + "元</td><td>" + esc(r.reason) + "</td><td>" + (r.status === "resolved" ? '<span class="pill green">已追回</span>' : '<span class="pill red">待追回</span>') + "</td><td>" + (r.status === "resolved" ? "" : '<button data-resolve="' + r.id + '">标记已追回</button>') + "</td></tr>").join("");
      $("#recoveries").innerHTML = rows ? "<table><thead><tr><th>赛事</th><th>足环</th><th>原收款人</th><th>金额</th><th>原因</th><th>状态</th><th></th></tr></thead><tbody>" + rows + "</tbody></table>" : '<p class="meta">暂无待追回。</p>';
      document.querySelectorAll("[data-resolve]").forEach(btn => btn.onclick = guard(async () => {
        await api("/api/recoveries/" + encodeURIComponent(btn.dataset.resolve) + "/resolve", { method: "POST", body: "{}" });
        await load();
      }));
    }
    function renderExceptions() {
      $("#exceptions").innerHTML = state.exceptions.length ? [...state.exceptions].reverse().map(e =>
        '<div class="small"><span class="pill amber">' + esc(typeNames[e.type] || e.type) + "</span> " + esc(e.message) + ' <span class="meta">' + esc(e.createdAt) + "</span></div>").join("") : '<p class="meta">暂无异常记录。</p>';
    }
    function renderArchive() {
      const rows = [...state.settlementArchive].reverse().map(l =>
        "<tr><td>" + esc(l.event) + "</td><td>" + esc(l.ringNo) + "</td><td>第" + l.rank + "名</td><td>" + l.amount + "元</td><td>" + esc(l.payee) + "</td><td>" + (l.status === "paid" ? "已发" : "待发") + "</td><td>" + esc(reasonNames[l.archiveReason] || l.archiveReason) + "</td><td class='meta'>" + esc(l.note || "") + "</td></tr>").join("");
      $("#archive").innerHTML = rows ? "<table><thead><tr><th>赛事</th><th>足环</th><th>名次</th><th>金额</th><th>收款人</th><th>发放状态</th><th>归档原因</th><th>备注</th></tr></thead><tbody>" + rows + "</tbody></table>" : '<p class="meta">暂无留档。</p>';
    }
    async function load() {
      Object.assign(state, await api("/api/settlement"));
      renderRaces(); renderLines(); renderRecoveries(); renderExceptions(); renderArchive();
    }
    $("#raceForm").onsubmit = guard(async event => {
      event.preventDefault();
      const form = event.target;
      const data = Object.fromEntries(new FormData(form).entries());
      const prizes = data.prizes.split("\\n").map(line => line.trim()).filter(Boolean).map(line => {
        const parts = line.split(/[\\s,，]+/);
        return { rank: Number(parts[0]), amount: Number(parts[1]) };
      });
      await api("/api/prize-races", { method: "POST", body: JSON.stringify({ event: data.event, releaseDate: data.releaseDate, prizes }) });
      form.reset();
      await load();
    });
    $("#reload").onclick = () => load();
    load();
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const db = await loadDb();
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(page);
    }
    if (req.method === "GET" && url.pathname === "/settlement") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(settlementPage);
    }
    if (req.method === "GET" && url.pathname === "/api/pigeons") return sendJson(res, 200, db.pigeons);
    if (req.method === "POST" && url.pathname === "/api/pigeons") {
      const input = await body(req);
      if (db.pigeons.some(item => item.ringNo === input.ringNo)) return sendJson(res, 409, { error: "ring_exists" });
      const pigeon = { ...input, vaccines: [], transfers: [], races: [] };
      db.pigeons.unshift(pigeon);
      await saveDb(db);
      return sendJson(res, 201, pigeon);
    }
    const relationMatch = url.pathname.match(/^\/api\/pigeons\/(.+)\/relation$/);
    if (relationMatch && req.method === "GET") {
      const data = relation(db, decodeURIComponent(relationMatch[1]));
      return data ? sendJson(res, 200, data) : sendJson(res, 404, { error: "pigeon_not_found" });
    }
    // 成绩更正/取消：改完榜单立即重算该场应收与待追回
    const resultMatch = url.pathname.match(/^\/api\/pigeons\/(.+)\/races\/(\d+)\/(correct|cancel)$/);
    if (resultMatch && req.method === "POST") {
      const pigeon = db.pigeons.find(item => item.ringNo === decodeURIComponent(resultMatch[1]));
      if (!pigeon) return sendJson(res, 404, { error: "pigeon_not_found" });
      const result = pigeon.races[Number(resultMatch[2])];
      if (!result) return sendJson(res, 404, { error: "result_not_found" });
      if (result.status === "cancelled") return sendJson(res, 409, { error: "成绩已取消，不能再操作" });
      const now = new Date().toISOString();
      if (resultMatch[3] === "correct") {
        const input = await body(req);
        const rank = Number(input.rank);
        if (!Number.isInteger(rank) || rank < 1) return sendJson(res, 400, { error: "名次必须是正整数" });
        result.revisions = [...(result.revisions || []), { rank: result.rank, returnTime: result.returnTime || "", changedAt: now }];
        result.rank = rank;
        if (input.returnTime !== undefined) result.returnTime = input.returnTime;
      } else {
        result.status = "cancelled";
        result.cancelledAt = now;
      }
      const race = db.prizeRaces.find(item => item.event === result.event && item.releaseDate === result.date && item.status === "open");
      const settlement = race ? settleRace(db, race.id, now) : null;
      await saveDb(db);
      return sendJson(res, 200, { pigeon, settlement });
    }
    const actionMatch = url.pathname.match(/^\/api\/pigeons\/(.+)\/(transfers|races|vaccines)$/);
    if (actionMatch && req.method === "POST") {
      const pigeon = db.pigeons.find(item => item.ringNo === decodeURIComponent(actionMatch[1]));
      if (!pigeon) return sendJson(res, 404, { error: "pigeon_not_found" });
      const input = await body(req);
      if (actionMatch[2] === "transfers") {
        const transfer = { date: input.date || new Date().toISOString().slice(0, 10), from: pigeon.owner, to: input.to };
        pigeon.owner = input.to;
        pigeon.transfers.push(transfer);
      }
      if (actionMatch[2] === "races") pigeon.races.push({ date: input.date || new Date().toISOString().slice(0, 10), event: input.event, distance: Number(input.distance || 0), returnTime: input.returnTime || "", rank: Number(input.rank || 0) });
      if (actionMatch[2] === "vaccines") pigeon.vaccines.push({ date: input.date || new Date().toISOString().slice(0, 10), name: input.name });
      await saveDb(db);
      return sendJson(res, 200, pigeon);
    }
    // 奖金结算台
    if (req.method === "GET" && url.pathname === "/api/settlement") {
      return sendJson(res, 200, { prizeRaces: db.prizeRaces, settlements: db.settlements, settlementArchive: db.settlementArchive, recoveries: db.recoveries, exceptions: db.exceptions });
    }
    if (req.method === "POST" && url.pathname === "/api/prize-races") {
      const race = registerPrizeRace(db, await body(req));
      await saveDb(db);
      return sendJson(res, 201, race);
    }
    const raceAction = url.pathname.match(/^\/api\/prize-races\/([^/]+)\/(settle|cancel)$/);
    if (raceAction && req.method === "POST") {
      const summary = raceAction[2] === "settle" ? settleRace(db, raceAction[1]) : cancelRace(db, raceAction[1]);
      await saveDb(db);
      return sendJson(res, 200, summary);
    }
    const payMatch = url.pathname.match(/^\/api\/settlements\/([^/]+)\/pay$/);
    if (payMatch && req.method === "POST") {
      const line = markLinePaid(db, decodeURIComponent(payMatch[1]));
      await saveDb(db);
      return sendJson(res, 200, line);
    }
    const recoveryMatch = url.pathname.match(/^\/api\/recoveries\/([^/]+)\/resolve$/);
    if (recoveryMatch && req.method === "POST") {
      const recovery = resolveRecovery(db, decodeURIComponent(recoveryMatch[1]));
      await saveDb(db);
      return sendJson(res, 200, recovery);
    }
    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message });
  }
});

server.listen(port, () => console.log(`Racing pigeon registry app listening on http://localhost:${port}`));
