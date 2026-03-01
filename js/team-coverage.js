// js/team-coverage.js
import { normalizeName } from "./player-key.js";

// Fixed category order (must always be visible in this order)
const HIT_CATS = ["AVG", "OPS", "TB", "SB", "HR", "R", "RBI"];
const PIT_CATS = ["ERA", "WHIP", "IP", "K", "QS", "SV", "HLD"];

// CSV column names for z-scores (as provided by your master.csv pipeline)
const ZCOL = {
  AVG: "zAVG",
  OPS: "zOPS",
  TB: "zTB",
  SB: "zSB",
  HR: "zHR",
  R: "zR",
  RBI: "zRBI",
  ERA: "zERA",
  WHIP: "zWHIP",
  IP: "zIP",
  K: "zK",
  QS: "zQS",
  SV: "zSV",
  HLD: "zHLD",
};

// Utility: safe number
function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

// +3.42 / -1.77 formatting
function fmtSigned(n) {
  const v = Math.round(n * 100) / 100;
  const s = v >= 0 ? "+" : "";
  return `${s}${v.toFixed(2)}`;
}

// Tooltip positioning
function placeTooltip(el, x, y) {
  const pad = 12;
  // display must be on before measuring
  const rect = el.getBoundingClientRect();

  let left = x + 14;
  let top = y + 14;

  if (left + rect.width + pad > window.innerWidth) left = x - rect.width - 14;
  if (top + rect.height + pad > window.innerHeight) top = y - rect.height - 14;

  el.style.left = `${Math.max(pad, left)}px`;
  el.style.top = `${Math.max(pad, top)}px`;
}

function buildTooltipHTML(cat, total, top5) {
  const items = top5
    .map(
      (r) =>
        `<div class="tt-item"><div class="nm">${r.name}</div><div class="val">${fmtSigned(
          r.z
        )}</div></div>`
    )
    .join("");

  return `
    <div class="tt-title">${cat} — Total ${fmtSigned(total)}</div>
    <div class="tt-sub">Top 5 contributors (signed z)</div>
    ${items || `<div class="tt-sub">No non-zero contributors on roster.</div>`}
  `;
}

// Build lookup maps for matching roster entries -> master.csv rows
function buildLookups(players) {
  const byKey = new Map(); // player_key -> row
  const byNormName = new Map(); // normalize(Name) -> row (first match)
  for (const p of players || []) {
    const key = String(p.player_key || "").trim();
    if (key) byKey.set(key, p);

    const nm = String(p.Name || "").trim();
    const nn = nm ? normalizeName(nm) : "";
    if (nn && !byNormName.has(nn)) byNormName.set(nn, p);
  }
  return { byKey, byNormName };
}

// Try to resolve a roster slot object to a master.csv player row
function resolveRosterPlayer(r, lookups) {
  if (!r) return null;
  const { byKey, byNormName } = lookups;

  // 1) direct player_key if stored on roster object
  const pk = String(r.player_key || "").trim();
  if (pk && byKey.has(pk)) return byKey.get(pk);

  // 2) id sometimes equals player_key in your app
  const rid = String(r.id || "").trim();
  if (rid && byKey.has(rid)) return byKey.get(rid);

  // 3) try roster name
  const nm = String(r.name || r.Name || "").trim();
  if (nm) {
    const nn = normalizeName(nm);
    if (nn && byNormName.has(nn)) return byNormName.get(nn);
  }

  // 4) sometimes roster stores "display" like "First Last • TEAM • POS"
  const disp = String(r.display || "").trim();
  if (disp) {
    const justName = disp.split("•")[0].trim();
    const nn = normalizeName(justName);
    if (nn && byNormName.has(nn)) return byNormName.get(nn);
  }

  return null;
}

/**
 * Render team category coverage (raw summed z-scores) for the current roster.
 * - Horizontal diverging bars (0 midpoint)
 * - Fixed category order
 * - Tooltip: top 5 contributors (by absolute contribution)
 */
export function renderTeamCoverage({ roster, players }) {
  const hitRoot = document.getElementById("tcHitting");
  const pitRoot = document.getElementById("tcPitching");
  if (!hitRoot || !pitRoot) return;

  // Ensure tooltip exists and ALWAYS lives on <body> (prevents clipping / Safari fixed issues)
let tt = document.getElementById("tcTooltip");
if (!tt) {
  tt = document.createElement("div");
  tt.id = "tcTooltip";
  tt.className = "tc-tooltip";
  tt.setAttribute("aria-hidden", "true");
}
// Force it onto the body even if it exists in the panel HTML
if (tt.parentElement !== document.body) {
  document.body.appendChild(tt);
}

  const lookups = buildLookups(players || []);

  // Resolve roster -> master.csv rows
  const rosterPlayers = [];
  for (const r of roster || []) {
    const p = resolveRosterPlayer(r, lookups);
    if (p) rosterPlayers.push(p);
  }

  const allCats = [...HIT_CATS, ...PIT_CATS];

  const totals = {};
  const contribs = {};
  for (const cat of allCats) {
    totals[cat] = 0;
    contribs[cat] = [];
  }

  for (const p of rosterPlayers) {
    const name = String(p.Name || "").trim() || "Unknown";
    for (const cat of allCats) {
      const z = num(p[ZCOL[cat]]);
      totals[cat] += z;
      if (z !== 0) contribs[cat].push({ name, z });
    }
  }

  // Dynamic scaling across all 14 categories
  const maxAbs = Math.max(1, ...allCats.map((c) => Math.abs(totals[c])));

  hitRoot.innerHTML = "";
  pitRoot.innerHTML = "";

  function makeRow(cat) {
    const total = totals[cat];
    const abs = Math.abs(total);
    const halfPct = Math.min(50, (abs / maxAbs) * 50); // 0..50

    const row = document.createElement("div");
    row.className = "tc-row";

    const label = document.createElement("div");
    label.className = "tc-label";
    label.textContent = cat;

    const bar = document.createElement("div");
    bar.className = "tc-bar";

    const mid = document.createElement("div");
    mid.className = "tc-midline";

    const fill = document.createElement("div");
    fill.className = "tc-fill " + (total >= 0 ? "pos" : "neg");
    fill.style.width = `${halfPct}%`;

    bar.appendChild(mid);
    bar.appendChild(fill);

    const value = document.createElement("div");
    value.className = "tc-value";
    value.textContent = fmtSigned(total);
    const b = badgeForTotal(total);
    const badge = document.createElement("div");
    badge.className = `tc-badge ${b.cls}`;
    badge.textContent = b.text;

    function badgeForTotal(total) {
  if (total >= 2.0) return { text: "Strong", cls: "strong" };
  if (total <= -2.0) return { text: "Weak", cls: "weak" };
  return { text: "Average", cls: "average" };
}

    // Top 5 contributors by absolute contribution (signed shown)
    const top5 = [...contribs[cat]]
      .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
      .slice(0, 5);

    const show = (evt) => {
      tt.innerHTML = buildTooltipHTML(cat, total, top5);
      tt.style.display = "block";
      tt.setAttribute("aria-hidden", "false");
      placeTooltip(tt, evt.clientX, evt.clientY);
    };

    const move = (evt) => {
      if (tt.style.display !== "block") return;
      placeTooltip(tt, evt.clientX, evt.clientY);
    };

    const hide = () => {
      tt.style.display = "none";
      tt.setAttribute("aria-hidden", "true");
    };

    // Hover anywhere on the row
    row.addEventListener("mouseenter", show);
    row.addEventListener("mousemove", move);
    row.addEventListener("mouseleave", hide);

    row.appendChild(label);
    row.appendChild(bar);
    row.appendChild(value);
    row.appendChild(badge);
    return row;
      }

  for (const cat of HIT_CATS) hitRoot.appendChild(makeRow(cat));
  for (const cat of PIT_CATS) pitRoot.appendChild(makeRow(cat));
}