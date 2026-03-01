// projections-page.js

import { loadPlayers } from "./projections-data.js";
import { normalizeName } from "./player-key.js";

let ALL = [];
let currentSort = "rank";

// Final position list + required order (user spec)
const POS_ORDER = ["C","1B","2B","3B","SS","CI","MI","LF","CF","RF","OF","SP","RP","CP"];

// Columns considered "hitting" vs "pitching" for hide/show by Type
const hitCols = ["AVG","OPS","TB","HR","R","RBI","SB"];
const pitCols = ["ERA","WHIP","IP","QS","K","SV","HLD"];

function normalize(s) {
  return normalizeName(s ?? "");
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ✅ IMPORTANT: Treat "" as NOT present
function isHitter(p) {
  return num(p.PA) > 0;
}
function isPitcher(p) {
  return num(p.IP) > 0;
}

function getProjValue(p) {
  return num(p.ProjVal ?? p["Proj Anchor"] ?? 0);
}

/**
 * Canonical position set per player:
 * - Fixes: P, starer -> SP, keeps RP/CP, adds CI/MI, adds OF
 * - Returns a Set of positions for filtering + display logic
 */
function getPosSet(p) {
  const raw = String(p.POS ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const out = new Set();

  // Normalize tokens
  raw.forEach(tok => {
    const t = tok.toUpperCase();

    if (t === "STARER") out.add("SP");              // typo in your data
    else if (t === "P") out.add("RP");              // collapse generic P into RP
    else if (t === "SP" || t === "RP" || t === "CP") out.add(t);
    else if (["C","1B","2B","3B","SS","LF","CF","RF","OF"].includes(t)) out.add(t);
  });

  // Derive OF if any OF sub-positions exist
  if (out.has("LF") || out.has("CF") || out.has("RF")) out.add("OF");

  // Derive CI/MI
  if (out.has("1B") || out.has("3B")) out.add("CI");
  if (out.has("2B") || out.has("SS")) out.add("MI");

  // If pitcher, ensure we have SP/RP/CP only
  if (isPitcher(p)) {
    // If data gave neither, default to RP
    if (!out.has("SP") && !out.has("RP") && !out.has("CP")) out.add("RP");
    // Remove hitter positions if any junk leaked in
    ["C","1B","2B","3B","SS","CI","MI","LF","CF","RF","OF"].forEach(x => out.delete(x));
  }

  return out;
}

function applyFilters(players) {
  const type = document.getElementById("projType").value;
  const pos = document.getElementById("projPos").value;
  const eligible = document.getElementById("eligOnly").checked;
  const search = normalize(document.getElementById("playerSearch").value);

  let result = [...players];

  // ✅ HARD GATE by type: now actually removes players
  if (type === "hit") result = result.filter(isHitter);
  if (type === "pit") result = result.filter(isPitcher);

  // Position filter (canonical)
  if (pos !== "all") {
    result = result.filter(p => getPosSet(p).has(pos));
  }

  // Eligible toggle (apply before cap)
  if (eligible) {
    result = result.filter(p =>
      isHitter(p) ? num(p.PA) >= 250 :
      isPitcher(p) ? num(p.IP) >= 35 :
      true
    );
  }

  // Search (name/team)
  if (search) {
    result = result.filter(p =>
      normalize(p.Name).includes(search) ||
      normalize(p.Team).includes(search)
    );
  }

  return result;
}

// Fixed sort direction rules:
// - Name/Team/POS ascending
// - ERA/WHIP ascending (lower is better)
// - Everything else descending
function sortDir(key) {
  if (["Name","Team","POS"].includes(key)) return +1;
  if (["ERA","WHIP"].includes(key)) return +1;
  return -1;
}

function sortPlayers(players) {
  const dir = sortDir(currentSort);

  return [...players].sort((a, b) => {
    // Rank means Proj value desc
    if (currentSort === "rank") {
      return getProjValue(b) - getProjValue(a);
    }

    // String sorts
    if (currentSort === "Name") return dir * normalize(a.Name).localeCompare(normalize(b.Name));
    if (currentSort === "Team") return dir * (String(a.Team ?? "")).localeCompare(String(b.Team ?? ""));
    if (currentSort === "POS")  return dir * (String(a.POS ?? "")).localeCompare(String(b.POS ?? ""));

    // Numeric sorts (missing treated as 0; for ERA/WHIP missing becomes 0 -> bubbles top; we fix below)
    let av = num(a[currentSort]);
    let bv = num(b[currentSort]);

    // For ERA/WHIP specifically: missing should sort LAST, not first.
    if (["ERA","WHIP"].includes(currentSort)) {
      const aMissing = !(Number(a[currentSort]) > 0);
      const bMissing = !(Number(b[currentSort]) > 0);
      if (aMissing && !bMissing) return +1;
      if (!aMissing && bMissing) return -1;
    }

    return dir * (av - bv);
  });
}

function assignProjRank(filteredPool) {
  // Rank within the filtered pool by ProjVal descending
  const byProj = [...filteredPool].sort((a, b) => getProjValue(b) - getProjValue(a));
  byProj.forEach((p, i) => (p._projRank = i + 1));
}

function applyCap(players) {
  const cap = document.getElementById("projShow").value;
  if (cap === "all") return players;
  return players.slice(0, Number(cap));
}

// Weighted “totals” for ratio stats:
// AVG = sum(AVG * PA) / sum(PA)
// ERA/WHIP = sum(stat * IP) / sum(IP)
function weightedAvg(arr, statKey, weightKey) {
  const wSum = arr.reduce((t, p) => t + num(p[weightKey]), 0);
  if (wSum <= 0) return 0;
  const vSum = arr.reduce((t, p) => t + (num(p[statKey]) * num(p[weightKey])), 0);
  return vSum / wSum;
}

function updateTotals(filteredPool) {
  const type = document.getElementById("projType").value;

  const hitters = filteredPool.filter(isHitter);
  const pitchers = filteredPool.filter(isPitcher);

  const sum = (arr, key) => arr.reduce((t, p) => t + num(p[key]), 0);

  const hitPA = sum(hitters, "PA");

  const avgW = weightedAvg(hitters, "AVG", "PA");
  const eraW = weightedAvg(pitchers, "ERA", "IP");
  const whipW = weightedAvg(pitchers, "WHIP", "IP");

  document.getElementById("hitTotals").textContent =
    `PA: ${Math.round(hitPA)} • AVG: ${avgW ? avgW.toFixed(3) : "—"} • OPS: ${weightedAvg(hitters,"OPS","PA") ? weightedAvg(hitters,"OPS","PA").toFixed(3) : "—"} • TB: ${Math.round(sum(hitters,"TB"))} • HR: ${Math.round(sum(hitters,"HR"))} • RBI: ${Math.round(sum(hitters,"RBI"))} • R: ${Math.round(sum(hitters,"R"))} • SB: ${Math.round(sum(hitters,"SB"))}`;

  document.getElementById("pitTotals").textContent =
    `IP: ${sum(pitchers,"IP").toFixed(1)} • ERA: ${eraW ? eraW.toFixed(2) : "—"} • WHIP: ${whipW ? whipW.toFixed(2) : "—"} • QS: ${Math.round(sum(pitchers,"QS"))} • K: ${Math.round(sum(pitchers,"K"))} • SV: ${Math.round(sum(pitchers,"SV"))} • HLD: ${Math.round(sum(pitchers,"HLD"))}`;

  // Hide/show totals boxes depending on type
  const hitBox = document.getElementById("hitTotals").parentElement;
  const pitBox = document.getElementById("pitTotals").parentElement;

  if (type === "hit") {
    hitBox.style.display = "";
    pitBox.style.display = "none";
  } else if (type === "pit") {
    hitBox.style.display = "none";
    pitBox.style.display = "";
  } else {
    hitBox.style.display = "";
    pitBox.style.display = "";
  }
}

function updateColumnVisibility() {
  const type = document.getElementById("projType").value;
  const headers = document.querySelectorAll("#projTable th");

  headers.forEach((th, index) => {
    const key = th.dataset.sort;
    if (!key) return;

    const hide =
      (type === "hit" && pitCols.includes(key)) ||
      (type === "pit" && hitCols.includes(key));

    th.style.display = hide ? "none" : "";

    document
      .querySelectorAll(`#projTable tr td:nth-child(${index + 1})`)
      .forEach(td => (td.style.display = hide ? "none" : ""));
  });
}

function render(players) {
  const tbody = document.getElementById("projTbody");
  tbody.innerHTML = "";

  players.forEach(p => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${p._projRank ?? ""}</td>
      <td>${p.Name}</td>
      <td>${p.Team ?? ""}</td>
      <td>${p.POS ?? ""}</td>

      <td>${num(p.AVG) ? num(p.AVG).toFixed(3) : 0}</td>
      <td>${num(p.OPS) ? num(p.OPS).toFixed(3) : 0}</td>
      <td>${Math.round(num(p.TB))}</td>
      <td>${Math.round(num(p.HR))}</td>
      <td>${Math.round(num(p.R))}</td>
      <td>${Math.round(num(p.RBI))}</td>
      <td>${Math.round(num(p.SB))}</td>

      <td>${num(p.ERA) ? num(p.ERA).toFixed(2) : 0}</td>
      <td>${num(p.WHIP) ? num(p.WHIP).toFixed(2) : 0}</td>
      <td>${num(p.IP) ? num(p.IP).toFixed(1) : 0}</td>
      <td>${Math.round(num(p.QS))}</td>
      <td>${Math.round(num(p.K))}</td>
      <td>${Math.round(num(p.SV))}</td>
      <td>${Math.round(num(p.HLD))}</td>
    `;

    tbody.appendChild(tr);
  });
}

function rebuild() {
  // 1) Filter
  const filtered = applyFilters(ALL);

  // 2) Compute proj-rank within the filtered pool (so ranks make sense)
  assignProjRank(filtered);

  // 3) Sort for display
  const sorted = sortPlayers(filtered);

  // 4) Cap for display
  const capped = applyCap(sorted);

  // ✅ Totals should match what’s displayed (post-cap)
  updateTotals(capped);

  // 5) Render
  render(capped);

  // 6) Hide irrelevant columns based on Type
  updateColumnVisibility();
}

async function init() {
  const { hitters, pitchers } = await loadPlayers();
  ALL = [...hitters, ...pitchers];

  // Populate Position dropdown in your REQUIRED order (not dynamic garbage)
  const posSelect = document.getElementById("projPos");
  posSelect.innerHTML = `<option value="all">All</option>`;
  POS_ORDER.forEach(pos => {
    const opt = document.createElement("option");
    opt.value = pos;
    opt.textContent = pos;
    posSelect.appendChild(opt);
  });

  // Header click sorting
  document.querySelectorAll("#projTable th").forEach(th => {
    th.addEventListener("click", () => {
      currentSort = th.dataset.sort;
      rebuild();
    });
  });

  // Controls
  ["projType","projPos","eligOnly","playerSearch","projShow"].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener("change", rebuild);
    el.addEventListener("input", rebuild);
  });

  rebuild();
}

init();