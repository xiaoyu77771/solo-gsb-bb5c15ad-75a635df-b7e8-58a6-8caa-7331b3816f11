/* 公交刷卡票价核验台 —— 原生前端逻辑（无框架、无构建） */
"use strict";

const $ = (id) => document.getElementById(id);

/* ---------------- 通用请求 / 提示 ---------------- */

async function api(path, options = {}) {
  const opts = Object.assign({ headers: {} }, options);
  if (opts.body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
  }
  const resp = await fetch(path, opts);
  let data = null;
  try {
    data = await resp.json();
  } catch (_) { /* 非 JSON 响应 */ }
  if (!resp.ok) {
    const err = new Error("HTTP " + resp.status);
    err.payload = data;
    throw err;
  }
  return data;
}

let toastTimer = null;
function toast(message, ok = true) {
  const el = $("toast");
  el.textContent = message;
  el.className = "toast " + (ok ? "ok" : "bad");
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function putText(path, text) {
  return api(path, { method: "PUT", body: JSON.stringify({ text }) });
}

function yuan(v) {
  return Number(v).toFixed(2);
}

function actionText(a) {
  return a === "IN" ? "进 ▲" : "出 ▼";
}

/* ---------------- 1. 规则参数 ---------------- */

async function loadConfig() {
  const cfg = await api("/api/config");
  $("cfg-split").value = cfg.day_split_hour;
  $("cfg-minutes").value = cfg.transfer_minutes;
  $("cfg-discount").value = cfg.transfer_discount;
  $("cfg-cap").value = cfg.daily_cap;
  // 草案初始跟随当前已保存参数，之后由用户自由修改（不保存）
  copyConfigToDraft();
}

function copyConfigToDraft() {
  $("draft-split").value = $("cfg-split").value;
  $("draft-minutes").value = $("cfg-minutes").value;
  $("draft-discount").value = $("cfg-discount").value;
  $("draft-cap").value = $("cfg-cap").value;
}

async function saveConfig() {
  const body = {
    day_split_hour: Number($("cfg-split").value),
    transfer_minutes: Number($("cfg-minutes").value),
    transfer_discount: Number($("cfg-discount").value),
    daily_cap: Number($("cfg-cap").value),
  };
  try {
    await api("/api/config", { method: "PUT", body: JSON.stringify(body) });
    toast("规则参数已保存");
  } catch (e) {
    toast(summaryError(e, "参数校验失败"), false);
  }
}

/* ---------------- 2-4. 文本录入与表格渲染 ---------------- */

function renderStations(items) {
  const tb = $("stations-table").querySelector("tbody");
  tb.innerHTML = "";
  for (const s of items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(s.name)}</td><td class="num">${s.zone}</td>`;
    tb.appendChild(tr);
  }
}

function renderFares(items) {
  const tb = $("fares-table").querySelector("tbody");
  tb.innerHTML = "";
  for (const f of items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="num">${f.from_zone}</td><td class="num">${f.to_zone}</td>
      <td class="num">${yuan(f.price)}</td>`;
    tb.appendChild(tr);
  }
}

function renderRecords(items) {
  const tb = $("records-table").querySelector("tbody");
  tb.innerHTML = "";
  for (const r of items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(r.card)}</td><td>${r.time}</td>
      <td>${escapeHtml(r.station)}</td><td>${actionText(r.action)}</td>
      <td class="num">第 ${r.src_line} 行</td>`;
    tb.appendChild(tr);
  }
}

async function saveTextSection(key, path, text, render) {
  try {
    const data = await putText(path, text);
    const fresh = await api(path);
    render(fresh.items);
    toast(`已保存 ${data.count} 条 ${key}`);
  } catch (e) {
    const errs = (e.payload && e.payload.errors) || [];
    if (errs.length) showParseErrors(errs);
    toast(summaryError(e, `保存${key}失败`), false);
  }
}

function showParseErrors(errors) {
  const list = errors.slice(0, 12).map((e) =>
    `第 ${e.location && e.location.line || "?"} 行：${e.message}`).join("\n");
  toast(`录入解析失败：\n${list}`, false);
  // toast 不支持换行样式时，仍可在核验结果区展示
  const ul = $("errors-list");
  ul.innerHTML = "";
  const panel = $("errors-panel");
  for (const e of errors) {
    ul.appendChild(renderErrorLi(e));
  }
  panel.hidden = false;
  $("bills-panel").hidden = true;
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function loadBack(kind) {
  const fresh = await api(`/api/${kind}`);
  let text = "";
  if (kind === "stations") {
    text = fresh.items.map((s) => `${s.name}, ${s.zone}`).join("\n");
    renderStations(fresh.items);
  } else if (kind === "fares") {
    text = fresh.items.map((f) =>
      `${f.from_zone}, ${f.to_zone}, ${yuan(f.price)}`).join("\n");
    renderFares(fresh.items);
  } else if (kind === "records") {
    text = fresh.items.map((r) =>
      `${r.card}, ${r.time}, ${r.station}, ${r.action}`).join("\n");
    renderRecords(fresh.items);
  }
  $(`${kind}-text`).value = text;
  toast("已从数据库回填");
}

/* ---------------- 票价矩阵模板 ---------------- */

function genFareTemplate() {
  const n = Math.max(1, Math.min(20, Number($("fare-zones").value) || 3));
  const lines = [];
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= n; j++) {
      // 模板建议价：同区 2 元，每跨一区 +1 元（用户可自行改价）
      const price = 2 + Math.abs(i - j);
      lines.push(`${i}, ${j}, ${price}.00`);
    }
  }
  $("fares-text").value = lines.join("\n");
  toast(`已生成 ${n}×${n} 对称模板，请核对并保存`);
}

/* ---------------- 5. 核验 ---------------- */

function renderErrorLi(e) {
  const li = document.createElement("li");
  const code = document.createElement("span");
  code.className = "error-code";
  code.textContent = e.code;
  li.appendChild(code);
  li.appendChild(document.createTextNode(e.message));
  if (e.location) {
    const parts = [];
    const loc = e.location;
    if (loc.line !== undefined) parts.push(`文本第 ${loc.line} 行`);
    if (loc.card) parts.push(`卡号 ${loc.card}`);
    if (loc.time) parts.push(`时刻 ${loc.time}`);
    if (loc.station) parts.push(`站点 ${loc.station}`);
    if (parts.length) {
      const span = document.createElement("span");
      span.className = "error-loc";
      span.textContent = "定位：" + parts.join(" · ");
      li.appendChild(span);
    }
  }
  return li;
}

function renderBills(bills) {
  const tb = $("bills-table").querySelector("tbody");
  tb.innerHTML = "";
  for (const b of bills) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(b.card)}</td>
      <td class="num">${b.seq}</td>
      <td>${b.operating_day}</td>
      <td>${b.entry_time}</td>
      <td>${b.exit_time}</td>
      <td>${escapeHtml(b.entry_station)}（${b.from_zone}区）</td>
      <td>${escapeHtml(b.exit_station)}（${b.to_zone}区）</td>
      <td class="num">${yuan(b.base_fare)}</td>
      <td class="num discount">-${yuan(b.discount)}</td>
      <td class="num charge">${yuan(b.charged_fare)}</td>
      <td class="num">${yuan(b.daily_cumulative)} / ${yuan(b.daily_cap)}</td>
      <td class="wrap">${escapeHtml(b.discount_source)}</td>`;
    tb.appendChild(tr);
  }
}

async function runVerify() {
  const status = $("verify-status");
  status.textContent = "核验中…";
  status.className = "status";
  try {
    const data = await api("/api/verify", { method: "POST" });
    renderBills(data.bills || []);
    $("bills-panel").hidden = false;
    $("errors-panel").hidden = true;
    status.textContent = `核验通过，共 ${data.bill_count} 笔行程账单`;
    status.className = "status ok";
    toast(`核验通过：${data.bill_count} 笔行程`);
  } catch (e) {
    const errors = (e.payload && e.payload.errors) || [];
    const ul = $("errors-list");
    ul.innerHTML = "";
    for (const err of errors) ul.appendChild(renderErrorLi(err));
    $("errors-panel").hidden = false;
    $("bills-panel").hidden = true;
    status.textContent = `核验未通过：${errors.length} 个错误（未生成账单）`;
    status.className = "status bad";
    toast(`核验未通过：${errors.length} 个错误`, false);
  }
}

/* ---------------- 6. 规则试算对比 ---------------- */

function diffText(v) {
  const n = Number(v);
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return sign + Math.abs(n).toFixed(2);
}

function diffClass(v) {
  const n = Number(v);
  if (n > 0) return "diff-pos";   // 草案更贵
  if (n < 0) return "diff-neg";   // 草案更省
  return "diff-zero";
}

function renderComparison(comp) {
  const tb = $("compare-table").querySelector("tbody");
  tb.innerHTML = "";
  if (!comp.trips.length) {
    tb.innerHTML = `<tr><td colspan="10" class="num">两套方案下均无行程账单</td></tr>`;
  }
  for (const t of comp.trips) {
    const cur = t.current || {};
    const drf = t.draft || {};
    const tr = document.createElement("tr");
    if (Number(t.diff) !== 0) tr.className = "changed";
    const dayHl = cur.operating_day !== drf.operating_day ? ' class="hl"' : "";
    tr.innerHTML = `
      <td>${escapeHtml(t.card)}</td>
      <td class="num">${t.seq}</td>
      <td>${t.entry_time} ${escapeHtml(t.entry_station)} → ${t.exit_time} ${escapeHtml(t.exit_station)}</td>
      <td>${cur.operating_day || "—"}</td>
      <td${dayHl}>${drf.operating_day || "—"}</td>
      <td class="num discount">-${yuan(cur.discount || 0)}</td>
      <td class="num discount">-${yuan(drf.discount || 0)}</td>
      <td class="num charge">${yuan(cur.charged_fare || 0)}</td>
      <td class="num charge">${yuan(drf.charged_fare || 0)}</td>
      <td class="num ${diffClass(t.diff)}">${diffText(t.diff)}</td>`;
    tb.appendChild(tr);
  }

  const cb = $("compare-card-table").querySelector("tbody");
  cb.innerHTML = "";
  for (const c of comp.per_card) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(c.card)}</td>
      <td class="num">${c.trips}</td>
      <td class="num">${yuan(c.current_total)}</td>
      <td class="num">${yuan(c.draft_total)}</td>
      <td class="num ${diffClass(c.diff)}">${diffText(c.diff)}</td>`;
    cb.appendChild(tr);
  }

  const t = comp.total;
  $("compare-total").innerHTML = `
    <span>行程数 <b>${t.trips}</b></span>
    <span>当前合计 <b>${yuan(t.current_total)}</b> 元</span>
    <span>草案合计 <b>${yuan(t.draft_total)}</b> 元</span>
    <span class="${diffClass(t.diff)}">差额（草案 − 当前）<b>${diffText(t.diff)}</b> 元</span>`;
}

function showSchemeErrors(scheme, info) {
  const panel = $(`compare-errors-${scheme}`);
  const ul = $(`compare-errors-${scheme}-list`);
  ul.innerHTML = "";
  if (!info || info.ok !== false || !info.errors || !info.errors.length) {
    panel.hidden = true;
    return 0;
  }
  for (const err of info.errors) ul.appendChild(renderErrorLi(err));
  panel.hidden = false;
  return info.errors.length;
}

async function runCompare() {
  const status = $("compare-status");
  const body = {
    day_split_hour: Number($("draft-split").value),
    transfer_minutes: Number($("draft-minutes").value),
    transfer_discount: Number($("draft-discount").value),
    daily_cap: Number($("draft-cap").value),
  };
  status.textContent = "试算中…";
  status.className = "status";
  try {
    const data = await api("/api/compare", { method: "POST", body: JSON.stringify(body) });
    renderComparison(data.comparison);
    showSchemeErrors("current", null);
    showSchemeErrors("draft", null);
    $("compare-panel").hidden = false;
    const t = data.comparison.total;
    status.textContent = `试算完成：${t.trips} 笔行程，当前 ${yuan(t.current_total)} 元 → 草案 ${yuan(t.draft_total)} 元（差额 ${diffText(t.diff)} 元）。未改配置、未写账单。`;
    status.className = "status ok";
    toast("试算对比完成");
  } catch (e) {
    const p = e.payload || {};
    $("compare-panel").hidden = true;
    const shown = showSchemeErrors("current", p.current) +
                  showSchemeErrors("draft", p.draft);
    if (shown > 0) {
      status.textContent = `试算未通过：共 ${shown} 个数据错误（未改配置、未写账单）`;
      status.className = "status bad";
      toast(`试算未通过：${shown} 个数据错误`, false);
    } else {
      status.textContent = summaryError(e, "试算失败");
      status.className = "status bad";
      toast(summaryError(e, "试算失败"), false);
    }
  }
  $("sec-compare").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ---------------- 演示数据 ---------------- */

const DEMO = {
  config: { day_split_hour: 4, transfer_minutes: 90,
            transfer_discount: 1, daily_cap: 10 },
  stations: `科技园, 1
中心公园, 2
大学城, 3`,
  fares: `1, 1, 2.00
1, 2, 3.00
1, 3, 4.00
2, 1, 3.00
2, 2, 2.00
2, 3, 3.00
3, 1, 4.00
3, 2, 3.00
3, 3, 2.00`,
  records: `A001, 2026-09-18 08:00:00, 科技园, 进
A001, 2026-09-18 08:25:00, 中心公园, 出
A001, 2026-09-18 09:10:00, 中心公园, 进
A001, 2026-09-18 09:50:00, 大学城, 出
A001, 2026-09-18 17:30:00, 大学城, 进
A001, 2026-09-18 18:20:00, 科技园, 出
A001, 2026-09-18 19:30:00, 科技园, 进
A001, 2026-09-18 20:00:00, 中心公园, 出
B002, 2026-09-19 03:20:00, 科技园, 进
B002, 2026-09-19 03:45:00, 中心公园, 出`,
};

async function loadDemo() {
  if (!confirm("将用演示数据覆盖当前参数 / 站点 / 票价 / 记录，是否继续？")) return;
  $("cfg-split").value = DEMO.config.day_split_hour;
  $("cfg-minutes").value = DEMO.config.transfer_minutes;
  $("cfg-discount").value = DEMO.config.transfer_discount;
  $("cfg-cap").value = DEMO.config.daily_cap;
  copyConfigToDraft();
  $("stations-text").value = DEMO.stations;
  $("fares-text").value = DEMO.fares;
  $("records-text").value = DEMO.records;

  await saveConfig();
  await putText("/api/stations", DEMO.stations);
  await putText("/api/fares", DEMO.fares);
  await putText("/api/records", DEMO.records);

  renderStations((await api("/api/stations")).items);
  renderFares((await api("/api/fares")).items);
  renderRecords((await api("/api/records")).items);
  toast("演示数据载入完成，开始核验…");
  await runVerify();
}

/* ---------------- 工具 ---------------- */

function summaryError(e, fallback) {
  const errs = e.payload && e.payload.errors;
  if (errs && errs.length) {
    const first = errs[0];
    const line = first.location && first.location.line;
    return `${fallback}：${line ? "第 " + line + " 行 " : ""}${first.message}`;
  }
  const detail = e.payload && e.payload.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length && detail[0].msg) {
    return `${fallback}：${detail[0].msg}`;
  }
  return fallback;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;",
  }[c]));
}

/* ---------------- 初始化 ---------------- */

function bind() {
  $("btn-save-config").addEventListener("click", saveConfig);

  $("btn-save-stations").addEventListener("click", () =>
    saveTextSection("站点", "/api/stations", $("stations-text").value, renderStations));
  $("btn-save-fares").addEventListener("click", () =>
    saveTextSection("票价", "/api/fares", $("fares-text").value, renderFares));
  $("btn-save-records").addEventListener("click", () =>
    saveTextSection("记录", "/api/records", $("records-text").value, renderRecords));

  $("btn-load-stations").addEventListener("click", () => loadBack("stations"));
  $("btn-load-fares").addEventListener("click", () => loadBack("fares"));
  $("btn-load-records").addEventListener("click", () => loadBack("records"));

  $("btn-gen-fares").addEventListener("click", genFareTemplate);
  $("btn-verify").addEventListener("click", runVerify);
  $("btn-verify-top").addEventListener("click", runVerify);
  $("btn-demo").addEventListener("click", loadDemo);
  $("btn-compare").addEventListener("click", runCompare);
  $("btn-copy-config").addEventListener("click", () => {
    copyConfigToDraft();
    toast("已将当前参数复制为试算草案");
  });
}

async function init() {
  bind();
  try {
    await loadConfig();
    renderStations((await api("/api/stations")).items);
    renderFares((await api("/api/fares")).items);
    renderRecords((await api("/api/records")).items);
    const bills = await api("/api/bills");
    if (bills.count > 0) {
      renderBills(bills.items);
      $("bills-panel").hidden = false;
      $("verify-status").textContent =
        `已加载上次核验结果（${bills.count} 笔，${bills.last_verified_at || ""}），修改数据后请重新核验`;
      $("verify-status").className = "status";
    }
  } catch (e) {
    toast("初始化加载数据失败：" + e.message, false);
  }
}

document.addEventListener("DOMContentLoaded", init);
