/* Chemical Demand Dashboard
   - Parses the weekly-updated "Chemical Demand Plan" data (Excel upload or Google Sheets sync)
   - Renders a per-month weekly demand table + a cross-month trend chart
   - Chemical filter, cumulative totals per chemical, and change-vs-previous-update summary
   - When Firebase is enabled (see firebase-config.js) every update is also saved to Firestore
     so the dashboard shows the same data to everyone who opens the page. */

const CHEM_ORDER = ["HNO3, 65%", "HF, 49%", "HCl, 31%", "KOH, 45%", "H2O2, 31%"];
const MONTH_ORDER = ["May 26","June 26","July 26","August 26","September 26","October 26","November 26","December 26"];
const SERIES_COLORS = {
  "HNO3, 65%": "#2a78d6",
  "HF, 49%": "#1baf7a",
  "HCl, 31%": "#eda100",
  "KOH, 45%": "#4a3aa7",
  "H2O2, 31%": "#e34948"
};

let currentData = null;   // { chemicalOrder, months: [...], updatedAt, lastDiff }
let activeMonthIdx = 0;
let chartInstance = null;
let selectedChemicals = new Set(CHEM_ORDER);

// ---------- Shared row parsing (works for SheetJS rows and Google Sheets API rows) ----------

function parseMonthRows(rows, sheetName) {
  let weekRowIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] && rows[i][1] === "Week") { weekRowIdx = i; break; }
  }

  const entry = { label: sheetName.replace(" 26", " 2026"), weeks: [], extraCols: [], chemicals: [] };
  if (weekRowIdx === -1) return entry;

  const header = rows[weekRowIdx];
  const weekCols = [];
  const extraCols = [];
  for (let ci = 2; ci < header.length; ci++) {
    const val = header[ci];
    if (typeof val === "number") weekCols.push([ci, Math.round(val)]);
    else if (val === "Projected" || val === "Ordered" || val === "Received") extraCols.push([ci, val]);
  }
  entry.weeks = weekCols.map(c => c[1]);
  entry.extraCols = extraCols.map(c => c[1]);

  for (let r = weekRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row[1] == null) continue;
    const name = row[1];
    if (CHEM_ORDER.includes(name)) {
      const weekValues = weekCols.map(([ci]) => (row[ci] != null ? row[ci] : null));
      const extraValues = extraCols.map(([ci]) => (row[ci] != null ? row[ci] : null));
      entry.chemicals.push({ name, weekValues, extraValues });
    }
  }
  return entry;
}

// ---------- Excel parsing (SheetJS) ----------

function parseWorkbook(workbook) {
  const months = MONTH_ORDER.map(sheetName => {
    if (!workbook.Sheets[sheetName]) return { label: sheetName.replace(" 26", " 2026"), weeks: [], extraCols: [], chemicals: [] };
    const ws = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
    return parseMonthRows(rows, sheetName);
  });
  return { chemicalOrder: CHEM_ORDER, months };
}

// ---------- Google Sheets API sync ----------

async function fetchFromGoogleSheets() {
  const cfg = window.GOOGLE_SHEETS_CONFIG;
  if (!cfg || !cfg.apiKey || !cfg.spreadsheetId) {
    throw new Error("google-sheets-config.js에 apiKey/spreadsheetId가 설정되어 있지 않습니다.");
  }
  const params = new URLSearchParams();
  MONTH_ORDER.forEach(name => params.append("ranges", `'${name}'!A1:K30`));
  params.append("valueRenderOption", "UNFORMATTED_VALUE");
  params.append("key", cfg.apiKey);

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.spreadsheetId}/values:batchGet?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Google Sheets API 오류 (${res.status}): ${errBody.slice(0, 200)}`);
  }
  const json = await res.json();
  const valueRanges = json.valueRanges || [];
  const months = MONTH_ORDER.map((sheetName, i) => parseMonthRows((valueRanges[i] && valueRanges[i].values) || [], sheetName));
  return { chemicalOrder: CHEM_ORDER, months };
}

// ---------- Diff (change vs previous update) ----------

function monthHasData(month) {
  return month.weeks.length > 0 && month.chemicals.length > 0;
}

function computeDiff(oldData, newData) {
  if (!oldData) return null;

  const oldMap = new Map();
  oldData.months.forEach(m => {
    m.chemicals.forEach(c => {
      c.weekValues.forEach((v, i) => oldMap.set(`${m.label}|${c.name}|w${i}`, v));
      c.extraValues.forEach((v, i) => oldMap.set(`${m.label}|${c.name}|e${i}`, v));
    });
  });

  const byChemical = {};
  CHEM_ORDER.forEach(name => { byChemical[name] = { delta: 0, changedCells: 0, newCells: 0 }; });

  newData.months.forEach(m => {
    m.chemicals.forEach(c => {
      c.weekValues.forEach((v, i) => {
        const key = `${m.label}|${c.name}|w${i}`;
        const oldV = oldMap.has(key) ? oldMap.get(key) : undefined;
        if (oldV === undefined) {
          if (v != null) { byChemical[c.name].newCells += 1; byChemical[c.name].delta += (v || 0); }
        } else if (oldV !== v) {
          byChemical[c.name].changedCells += 1;
          byChemical[c.name].delta += ((v || 0) - (oldV || 0));
        }
      });
    });
  });

  const hasAnyChange = Object.values(byChemical).some(d => d.delta !== 0 || d.changedCells > 0 || d.newCells > 0);
  return { byChemical, hasAnyChange, comparedAt: new Date().toISOString() };
}

// ---------- Rendering ----------

function fmt(n) {
  if (n == null) return "–";
  return Number(n).toLocaleString("en-US");
}

function fmtDelta(n) {
  const sign = n > 0 ? "+" : "";
  return sign + Number(n).toLocaleString("en-US");
}

function renderKPI(data) {
  const kpiRow = document.getElementById("kpiRow");
  const filled = data.months.filter(monthHasData);
  const lastMonth = filled[filled.length - 1];
  let latestWeekTotal = 0;
  let latestWeekLabel = "–";
  if (lastMonth) {
    const lastIdx = lastMonth.weeks.length - 1;
    latestWeekLabel = "W" + lastMonth.weeks[lastIdx];
    lastMonth.chemicals.forEach(c => {
      if (selectedChemicals.has(c.name)) latestWeekTotal += (c.weekValues[lastIdx] || 0);
    });
  }
  const totalWeeks = filled.reduce((s, m) => s + m.weeks.length, 0);
  let enteredActuals = 0;
  filled.forEach(m => m.chemicals.forEach(c => c.extraValues.forEach(v => { if (v != null) enteredActuals++; })));

  kpiRow.innerHTML = `
    <div class="kpi-card"><p class="label">추적 화학물질 (Chemicals)</p><p class="value">${data.chemicalOrder.length}<span class="unit"> 종</span></p></div>
    <div class="kpi-card"><p class="label">데이터 있는 주 (Weeks)</p><p class="value">${totalWeeks}<span class="unit"> 주</span></p></div>
    <div class="kpi-card"><p class="label">최신 주(${latestWeekLabel}) 총 Demand</p><p class="value">${fmt(latestWeekTotal)}<span class="unit"> L</span></p></div>
    <div class="kpi-card"><p class="label">Projected/Ordered/Received 입력</p><p class="value">${enteredActuals}<span class="unit"> 건</span></p></div>
  `;
}

function renderChemicalFilter(data) {
  const el = document.getElementById("chemicalFilter");
  el.innerHTML = "";
  data.chemicalOrder.forEach(name => {
    const label = document.createElement("label");
    label.className = "chem-toggle";
    const dot = `<span class="legend-dot" style="background:${SERIES_COLORS[name]}"></span>`;
    label.innerHTML = `<input type="checkbox" ${selectedChemicals.has(name) ? "checked" : ""} data-chem="${name}"> ${dot}${name}`;
    label.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) selectedChemicals.add(name);
      else selectedChemicals.delete(name);
      renderKPI(currentData);
      renderTable(currentData);
      renderChart(currentData);
      renderTotals(currentData);
    });
    el.appendChild(label);
  });
}

function renderMonthTabs(data) {
  const tabs = document.getElementById("monthTabs");
  tabs.innerHTML = "";
  data.months.forEach((m, idx) => {
    const btn = document.createElement("button");
    btn.className = "month-tab" + (idx === activeMonthIdx ? " active" : "") + (monthHasData(m) ? "" : " empty");
    btn.textContent = m.label.replace(" 2026", "");
    btn.onclick = () => { activeMonthIdx = idx; renderMonthTabs(data); renderTable(data); };
    tabs.appendChild(btn);
  });
}

function renderTable(data) {
  const table = document.getElementById("demandTable");
  const month = data.months[activeMonthIdx];
  if (!monthHasData(month)) {
    table.innerHTML = `<tbody><tr><td style="text-align:center; color: var(--text-muted); padding: 24px;">
      ${month.label}에는 아직 주간 Demand 데이터가 입력되지 않았습니다. 업데이트되면 자동으로 채워집니다.
    </td></tr></tbody>`;
    return;
  }

  const visibleChemicals = month.chemicals.filter(c => selectedChemicals.has(c.name));

  let thead = "<thead><tr><th>화학물질 (Chemical)</th>";
  month.weeks.forEach(w => { thead += `<th>W${w}</th>`; });
  thead += "<th>합계</th>";
  month.extraCols.forEach(c => { thead += `<th>${c}</th>`; });
  thead += "</tr></thead>";

  let tbody = "<tbody>";
  const weekTotals = month.weeks.map(() => 0);
  visibleChemicals.forEach(c => {
    tbody += `<tr><td>${c.name}</td>`;
    let rowTotal = 0;
    c.weekValues.forEach((v, i) => {
      weekTotals[i] += (v || 0);
      rowTotal += (v || 0);
      tbody += `<td class="${v ? "" : "zero"}">${fmt(v)}</td>`;
    });
    tbody += `<td class="row-total">${fmt(rowTotal)}</td>`;
    c.extraValues.forEach(v => { tbody += `<td class="extra-col">${fmt(v)}</td>`; });
    tbody += "</tr>";
  });
  const grandTotal = weekTotals.reduce((a, b) => a + b, 0);
  tbody += `<tr class="total-row"><td>합계 (Total)</td>`;
  weekTotals.forEach(t => { tbody += `<td>${fmt(t)}</td>`; });
  tbody += `<td class="row-total">${fmt(grandTotal)}</td>`;
  month.extraCols.forEach(() => { tbody += `<td>–</td>`; });
  tbody += "</tr></tbody>";

  table.innerHTML = thead + tbody;
}

function renderTotals(data) {
  const el = document.getElementById("chemTotals");
  const totals = {};
  data.chemicalOrder.forEach(name => { totals[name] = 0; });
  data.months.filter(monthHasData).forEach(m => {
    m.chemicals.forEach(c => {
      if (!selectedChemicals.has(c.name)) return;
      c.weekValues.forEach(v => { totals[c.name] += (v || 0); });
    });
  });

  el.innerHTML = "";
  data.chemicalOrder.filter(name => selectedChemicals.has(name)).forEach(name => {
    const card = document.createElement("div");
    card.className = "kpi-card";
    card.innerHTML = `<p class="label"><span class="legend-dot" style="background:${SERIES_COLORS[name]}"></span>${name}</p><p class="value">${fmt(totals[name])}<span class="unit"> L</span></p>`;
    el.appendChild(card);
  });
}

function renderDiffPanel(data) {
  const el = document.getElementById("diffPanel");
  const diff = data.lastDiff;
  if (!diff) {
    el.innerHTML = `<p class="diff-empty">아직 비교할 이전 업데이트가 없습니다.</p>`;
    return;
  }
  if (!diff.hasAnyChange) {
    el.innerHTML = `<p class="diff-empty">직전 업데이트 대비 변경사항이 없습니다.</p>`;
    return;
  }
  const rows = CHEM_ORDER
    .filter(name => selectedChemicals.has(name))
    .map(name => diff.byChemical[name])
    .map((d, idx) => [CHEM_ORDER[idx], d]);

  let html = "";
  CHEM_ORDER.filter(name => selectedChemicals.has(name)).forEach(name => {
    const d = diff.byChemical[name];
    if (!d || (d.delta === 0 && d.changedCells === 0 && d.newCells === 0)) {
      html += `<div class="diff-row"><span class="legend-dot" style="background:${SERIES_COLORS[name]}"></span><span class="diff-name">${name}</span><span class="diff-unchanged">변동 없음</span></div>`;
      return;
    }
    const deltaClass = d.delta > 0 ? "diff-up" : (d.delta < 0 ? "diff-down" : "diff-flat");
    const parts = [];
    if (d.newCells) parts.push(`신규 ${d.newCells}건`);
    if (d.changedCells) parts.push(`변경 ${d.changedCells}건`);
    html += `<div class="diff-row"><span class="legend-dot" style="background:${SERIES_COLORS[name]}"></span><span class="diff-name">${name}</span><span class="${deltaClass}">${fmtDelta(d.delta)}L</span><span class="diff-meta">(${parts.join(", ")})</span></div>`;
  });
  el.innerHTML = html;
}

function renderChart(data) {
  const legendEl = document.getElementById("chartLegend");
  legendEl.innerHTML = "";
  data.chemicalOrder.filter(name => selectedChemicals.has(name)).forEach(name => {
    const item = document.createElement("span");
    item.className = "legend-item";
    item.innerHTML = `<span class="legend-dot" style="background:${SERIES_COLORS[name]}"></span>${name}`;
    legendEl.appendChild(item);
  });

  const labels = [];
  const series = {};
  data.chemicalOrder.forEach(c => { series[c] = []; });

  data.months.forEach(m => {
    if (!monthHasData(m)) return;
    m.weeks.forEach((w, i) => {
      labels.push(m.label.replace(" 2026", "").slice(0, 3) + " W" + w);
      data.chemicalOrder.forEach(name => {
        const chem = m.chemicals.find(c => c.name === name);
        series[name].push(chem ? (chem.weekValues[i] || 0) : 0);
      });
    });
  });

  const ctx = document.getElementById("trendChart");
  if (chartInstance) chartInstance.destroy();
  const visibleChems = data.chemicalOrder.filter(name => selectedChemicals.has(name));
  chartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: visibleChems.map(name => ({
        label: name,
        data: series[name],
        borderColor: SERIES_COLORS[name],
        backgroundColor: SERIES_COLORS[name],
        borderWidth: 2,
        pointRadius: 3,
        tension: 0.15
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 45 } },
        y: { grid: { color: "rgba(137,135,129,0.25)" }, ticks: { callback: v => (v / 1000) + "k" } }
      }
    }
  });
}

function renderAll(data) {
  currentData = data;
  if (activeMonthIdx >= data.months.length) activeMonthIdx = 0;
  renderKPI(data);
  renderChemicalFilter(data);
  renderMonthTabs(data);
  renderTable(data);
  renderTotals(data);
  renderDiffPanel(data);
  renderChart(data);
}

// ---------- Update pipeline (shared by Excel upload + Google Sheets sync) ----------

async function applyNewData(newData, statusEl, sourceLabel) {
  const previous = currentData;
  const diff = computeDiff(previous, newData);
  const payload = { ...newData, updatedAt: new Date().toISOString(), lastDiff: diff };

  renderAll(payload);
  statusEl.textContent = `${sourceLabel} 업데이트 완료 (${new Date().toLocaleString("ko-KR")})`;

  if (window.FIREBASE_ENABLED && window.saveDemandDataToFirebase) {
    await window.saveDemandDataToFirebase(payload);
    statusEl.textContent += " — Firebase에 저장됨";
  }
}

// ---------- Upload handling ----------

document.getElementById("fileInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById("uploadStatus");
  statusEl.textContent = "파싱 중... (parsing)";
  try {
    const buf = await file.arrayBuffer();
    const workbook = XLSX.read(buf, { type: "array", cellDates: true });
    const data = parseWorkbook(workbook);
    await applyNewData(data, statusEl, "엑셀");
  } catch (err) {
    console.error(err);
    statusEl.textContent = "오류: 엑셀 파일을 확인해주세요.";
  }
  e.target.value = "";
});

document.getElementById("sheetsSyncBtn").addEventListener("click", async () => {
  const statusEl = document.getElementById("uploadStatus");
  statusEl.textContent = "구글시트에서 불러오는 중... (syncing)";
  try {
    const data = await fetchFromGoogleSheets();
    await applyNewData(data, statusEl, "구글시트");
  } catch (err) {
    console.error(err);
    statusEl.textContent = "오류: " + err.message;
  }
});

// ---------- Initial load ----------

async function init() {
  if (window.FIREBASE_ENABLED && window.loadDemandDataFromFirebase) {
    const remote = await window.loadDemandDataFromFirebase();
    if (remote) { renderAll(remote); return; }
  }
  const res = await fetch("demo-data.json");
  const data = await res.json();
  renderAll(data);
}

init();
