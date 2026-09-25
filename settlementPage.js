// 结算台页面：登记赛事奖金、触发结算、查看每笔应收、待追回和异常记录。
export const settlementPage = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>奖金结算台</title>
  <style>
    :root { --bg:#eff2f5; --panel:#fff; --ink:#1f2833; --muted:#697786; --line:#d3dce4; --accent:#315f83; --red:#9b3f35; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; }
    form,.panel { background:#fff; border:1px solid var(--line); border-radius:8px; padding:16px; } h2 { margin:0 0 12px; font-size:18px; } h3 { margin:16px 0 8px; font-size:15px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; }
    textarea { min-height:110px; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:8px 12px; font-weight:700; cursor:pointer; }
    button.ghost { background:#fff; color:var(--accent); border:1px solid var(--accent); }
    button.danger { background:var(--red); }
    a { color:var(--accent); font-weight:700; text-decoration:none; }
    .meta { color:var(--muted); font-size:13px; } .section { margin-top:14px; }
    .event-item { background:#f8fafb; border:1px solid var(--line); border-radius:8px; padding:10px; margin-bottom:10px; display:grid; gap:6px; }
    table { width:100%; border-collapse:collapse; margin:8px 0; font-size:14px; }
    th,td { border-bottom:1px solid var(--line); padding:7px 8px; text-align:left; }
    th { color:var(--muted); font-size:12px; }
    .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .pill.warn { color:var(--red); border-color:var(--red); }
    .notice { margin:0 0 10px; padding:9px 12px; border-radius:6px; background:#fdf3e7; border:1px solid #e8c48a; font-size:13px; display:none; }
    details { border:1px solid var(--line); border-radius:8px; padding:8px 10px; margin-bottom:8px; background:#f8fafb; }
    summary { cursor:pointer; font-weight:700; }
    .rank-edit { width:70px; display:inline-block; padding:5px; }
    .ops { white-space:nowrap; } .ops button { margin-left:6px; padding:5px 9px; font-size:12px; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header>
    <div><h1>奖金结算台</h1><div class="meta">按足环、放飞日和名次结算，收款人取比赛当天有效的鸽主</div></div>
    <div><a href="/">返回档案</a> <button id="reload">刷新</button></div>
  </header>
  <main>
    <div>
      <form id="eventForm">
        <h2>登记赛事奖金</h2>
        <label>赛事名称</label><input name="event" required placeholder="如 300公里大奖赛">
        <label>放飞日期</label><input name="releaseDate" type="date" required>
        <label>奖金表（每行：名次 金额）</label>
        <textarea name="prizes" required placeholder="1 5000&#10;2 3000&#10;3 1000"></textarea>
        <button>保存奖金方案</button>
      </form>
      <div class="panel section">
        <h2>赛事列表</h2>
        <div id="events"></div>
      </div>
    </div>
    <section>
      <div class="notice" id="notice"></div>
      <div class="panel" id="detail"><h2>结算明细</h2><p class="meta">从左侧选择一场赛事查看。</p></div>
    </section>
  </main>
  <script>
    const eventForm = document.querySelector("#eventForm");
    const eventsBox = document.querySelector("#events");
    const detail = document.querySelector("#detail");
    const notice = document.querySelector("#notice");
    let events = [];
    let currentEventId = null;
    let currentEvent = null;
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ "Content-Type":"application/json" } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "请求失败");
      return data;
    }
    function showNotice(text) { notice.textContent = text || ""; notice.style.display = text ? "block" : "none"; }
    async function guard(job) { try { await job(); } catch (error) { showNotice(error.message); } }
    function parsePrizes(raw) {
      return raw.split(/\\n+/).map(line => line.trim()).filter(Boolean).map(line => {
        const parts = line.split(/[\\s,，]+/);
        return { rank: Number(parts[0]), amount: Number(parts[1]) };
      });
    }
    function renderEvents() {
      eventsBox.innerHTML = events.map(item => {
        const active = item.activeSettlement;
        const status = active
          ? '<span class="pill">v' + active.version + ' 生效中 · 应发 ' + active.total + ' 元 / ' + active.lineCount + ' 笔</span>'
          : '<span class="pill warn">未结算</span>';
        return '<div class="event-item"><b>' + item.event + '</b><div class="meta">放飞日 ' + item.releaseDate + ' · 奖金覆盖 ' + item.prizes.length + ' 个名次</div><div>' + status + '</div><div><button data-settle="' + item.id + '">' + (active ? "重新结算" : "结算") + '</button> <button class="ghost" data-view="' + item.id + '">查看</button></div></div>';
      }).join("") || '<p class="meta">尚未登记赛事奖金。</p>';
      eventsBox.querySelectorAll("[data-settle]").forEach(btn => btn.onclick = () => guard(async () => {
        const result = await api("/api/prize-events/" + encodeURIComponent(btn.dataset.settle) + "/settle", { method:"POST", body:"{}" });
        showNotice(result.changed ? "已生成 v" + result.settlement.version + " 结算，旧版本已留档。" : "榜单无变化，未重复结算。");
        currentEventId = btn.dataset.settle;
        await load();
      }));
      eventsBox.querySelectorAll("[data-view]").forEach(btn => btn.onclick = () => guard(async () => {
        currentEventId = btn.dataset.view;
        await showEvent(currentEventId);
      }));
    }
    function lineTable(lines, withOps) {
      if (!lines.length) return '<p class="meta">无应发记录。</p>';
      return '<table><tr><th>名次</th><th>足环号</th><th>收款人（比赛日鸽主）</th><th>金额</th>' + (withOps ? '<th>榜单更正</th>' : '') + '</tr>' +
        lines.map(line => '<tr><td>第 ' + line.rank + ' 名</td><td>' + line.ringNo + '</td><td>' + line.payee + '</td><td>' + line.amount + ' 元</td>' +
          (withOps ? '<td class="ops"><input class="rank-edit" data-rank="' + line.ringNo + '" value="' + line.rank + '"><button class="ghost" data-correct="' + line.ringNo + '">改名次</button><button class="danger" data-cancel="' + line.ringNo + '">取消成绩</button></td>' : '') + '</tr>').join("") + '</table>';
    }
    function renderDetail(data) {
      const active = data.settlements.find(item => item.status === "active");
      const archived = data.settlements.filter(item => item.status !== "active");
      let html = '<h2>' + data.event.event + ' · 放飞日 ' + data.event.releaseDate + '</h2>';
      if (!active) {
        html += '<p class="meta">尚未结算，请在左侧点击“结算”。</p>';
      } else {
        const total = active.lines.reduce((sum, line) => sum + line.amount, 0);
        html += '<h3>每笔应收 <span class="pill">v' + active.version + ' 生效中 · ' + active.createdAt.slice(0, 19).replace("T", " ") + '</span></h3>';
        html += lineTable(active.lines, true);
        html += '<div><b>合计应发：' + total + ' 元</b></div>';
        if (active.recoveries.length) {
          html += '<h3>待追回</h3><table><tr><th>足环号</th><th>原收款人</th><th>金额</th><th>原因</th></tr>' +
            active.recoveries.map(item => '<tr><td>' + item.ringNo + '</td><td>' + item.payee + '</td><td>' + item.amount + ' 元</td><td>' + item.reason + '</td></tr>').join("") + '</table>';
        }
        if (active.exceptions.length) {
          html += '<h3>异常记录</h3><ul>' + active.exceptions.map(item => '<li>' + item.message + '</li>').join("") + '</ul>';
        }
      }
      if (archived.length) {
        html += '<h3>旧结算留档</h3>' + archived.map(item =>
          '<details><summary>v' + item.version + ' · ' + item.createdAt.slice(0, 19).replace("T", " ") + ' · ' + item.lines.length + ' 笔（已留档，不再付款）</summary>' + lineTable(item.lines, false) + '</details>').join("");
      }
      detail.innerHTML = html;
      detail.querySelectorAll("[data-correct]").forEach(btn => btn.onclick = () => guard(async () => {
        const ringNo = btn.dataset.correct;
        const rank = Number(detail.querySelector('[data-rank="' + ringNo + '"]').value);
        await api("/api/pigeons/" + encodeURIComponent(ringNo) + "/races/correct", { method:"POST", body: JSON.stringify({ event: currentEvent.event, date: currentEvent.releaseDate, rank }) });
        const result = await api("/api/prize-events/" + encodeURIComponent(currentEventId) + "/settle", { method:"POST", body:"{}" });
        showNotice(result.changed ? "名次已更正，重新结算为 v" + result.settlement.version + "，差额列入待追回。" : "名次已更正，应发无变化。");
        await load();
      }));
      detail.querySelectorAll("[data-cancel]").forEach(btn => btn.onclick = () => guard(async () => {
        const ringNo = btn.dataset.cancel;
        await api("/api/pigeons/" + encodeURIComponent(ringNo) + "/races/correct", { method:"POST", body: JSON.stringify({ event: currentEvent.event, date: currentEvent.releaseDate, cancelled: true }) });
        const result = await api("/api/prize-events/" + encodeURIComponent(currentEventId) + "/settle", { method:"POST", body:"{}" });
        showNotice(result.changed ? "成绩已取消，重新结算为 v" + result.settlement.version + "，原应发列入待追回。" : "成绩已取消。");
        await load();
      }));
    }
    async function showEvent(id) {
      const data = await api("/api/prize-events/" + encodeURIComponent(id) + "/settlements");
      currentEvent = data.event;
      renderDetail(data);
    }
    async function load() {
      events = await api("/api/prize-events");
      renderEvents();
      if (currentEventId) await showEvent(currentEventId);
    }
    eventForm.onsubmit = event => {
      event.preventDefault();
      guard(async () => {
        const fd = new FormData(eventForm);
        await api("/api/prize-events", { method:"POST", body: JSON.stringify({ event: fd.get("event"), releaseDate: fd.get("releaseDate"), prizes: parsePrizes(fd.get("prizes")) }) });
        eventForm.reset();
        showNotice("奖金方案已登记。");
        await load();
      });
    };
    document.querySelector("#reload").onclick = () => guard(load);
    guard(load);
  </script>
</body>
</html>`;
