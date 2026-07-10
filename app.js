/* Chemical Demand Dashboard
   - Parses the weekly-updated "Chemical Demand Plan" Excel file entirely in the browser (SheetJS)
   - Renders a per-month weekly demand table + a cross-month trend chart
   - When Firebase is enabled (see firebase-config.js) every upload is also saved to Firestore
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

let currentData = null;   // { chemicalOrder, months: [...] }
let activeMonthIdx = 0;
let chartInstance = null;

// ---------- Excel parsing ----------

function parseWorkbook(workbook) {
  const months = [];
  MONTH_ORDER.forEach(sheetName => {
    if (!workbook.Sheets[sheetName]) return;
    const ws = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });

    let weekRowIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i][1] === "Week") { weekRowIdx = i; break; }
    }

    const entry = { label: sheetName.replace(" 26", " 2026"), weeks: [], extraCols: [], chemicals: [] };
    if (weekRowIdx === -1) { months.push(entry); return; }

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
    months.push(entry);
  });
  return { chemicalOrder: CHEM_ORDER, months };
}

// ---------- Rendering ----------

function fmt(n) {
  if (n == null) return "–";
  return Number(n).toLocaleString("en-US");
}

function monthHasData(month) {
  return month.weeks.length > 0 && month.chemicals.length > 0;
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
    lastMonth.chemicals.forEach(c => { latestWeekTotal += (c.weekValues[lastIdx] || 0); });
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
      ${month.label}에는 아직 주간 Demand 데이터가 입력되지 않았습니다. 엑셀이 업데이트되면 자동으로 채워집니다.
    </td></tr></tbody>`;
    return;
  }

  let thead = "<thead><tr><th>화학물질 (Chemical)</th>";
  month.weeks.forEach(w => { thead += `<th>W${w}</th>`; });
  month.extraCols.forEach(c => { thead += `<th>${c}</th>`; });
  thead += "</tr></thead>";

  let tbody = "<tbody>";
  const weekTotals = month.weeks.map(() => 0);
  month.chemicals.forEach(c => {
    tbody += `<tr><td>${c.name}</td>`;
    c.weekValues.forEach((v, i) => {
      weekTotals[i] += (v || 0);
      tbody += `<td class="${v ? "" : "zero"}">${fmt(v)}</td>`;
    });
    c.extraValues.forEach(v => { tbody += `<td class="extra-col">${fmt(v)}</td>`; });
    tbody += "</tr>";
  });
  tbody += `<tr class="total-row"><td>합계 (Total)</td>`;
  weekTotals.forEach(t => { tbody += `<td>${fmt(t)}</td>`; });
  month.extraCols.forEach(() => { tbody += `<td>–</td>`; });
  tbody += "</tr></tbody>";

  table.innerHTML = thead + tbody;
}

function renderChart(data) {
  const legendEl = document.getElementById("chartLegend");
  legendEl.innerHTML = "";
  data.chemicalOrder.forEach(name => {
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
  chartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: data.chemicalOrder.map(name => ({
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
  renderMonthTabs(data);
  renderTable(data);
  renderChart(data);
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
    renderAll(data);
    statusEl.textContent = `업데이트 완료 (${new Date().toLocaleString("ko-KR")})`;

    if (window.FIREBASE_ENABLED && window.saveDemandDataToFirebase) {
      await window.saveDemandDataToFirebase(data);
      statusEl.textContent += " — Firebase에 저장됨";
    }
  } catch (err) {
    console.error(err);
    statusEl.textContent = "오류: 엑셀 파일을 확인해주세요.";
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
