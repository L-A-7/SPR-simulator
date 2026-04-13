"use strict";

// ============================================================
//  Configuration
// ============================================================
const API = "";           // same origin — change to "http://localhost:8000" for dev

// ============================================================
//  Canvas geometry — base values at reference width CW_BASE
//  All variables are updated proportionally by resizeCanvas().
// ============================================================
const CW_BASE       = 700;  // reference canvas width
const CH_BASE       = 300;  // reference canvas height
const CY_BASE       = 100;  // y of flat face
const R_BASE        = 180;  // half-disk radius
const GOLD_H_BASE   =   8;  // visual gold thickness
const BEAM_EXT_BASE =  80;  // beam extension outside disk

let CW       = CW_BASE;
let CH       = CH_BASE;
let CX       = CW / 2;
let CY       = CY_BASE;
let R        = R_BASE;
let GOLD_H   = GOLD_H_BASE;
let BEAM_EXT = BEAM_EXT_BASE;

// ============================================================
//  Color palette — single source of truth for canvas and chart
// ============================================================

// HSL component strings — combine with hsla() for dynamic alpha
const CHSL_BLUE_400 = "204, 68%, 55%";
const CHSL_GOLD_500 = "44, 90%, 50%";
const CHSL_GOLD_700 = "44, 88%, 38%";
const CHSL_RED_400  = "0, 100%, 71%";
const CHSL_RED_500  = "0, 100%, 63%";
const CHSL_WHITE    = "0, 0%, 100%";

// Opaque colors
const CLR_BLUE_900  = "hsl(204, 72%, 18%)";       // --blue-900
const CLR_BLUE_800  = "hsl(204, 70%, 27%)";       // --blue-800
const CLR_BLUE_700  = "hsl(204, 70%, 31%)";       // --blue-700
const CLR_BLUE_600  = "hsl(204, 73%, 34%)";       // --blue-600
const CLR_BLUE_400  = `hsl(${CHSL_BLUE_400})`;    // --blue-400
const CLR_BLUE_200  = "hsl(204, 60%, 82%)";       // --blue-200
const CLR_GOLD_800  = "hsl(44, 88%, 32%)";        // --gold-800
const CLR_GOLD_550  = "hsl(44, 90%, 46%)";        // --gold-550
const CLR_GOLD_500  = `hsl(${CHSL_GOLD_500})`;    // --gold-500
const CLR_RED_400   = `hsl(${CHSL_RED_400})`;     // --red-400
const CLR_RED_500   = `hsl(${CHSL_RED_500})`;     // --red-500
const CLR_WHITE     = "#ffffff";
const CLR_BLACK     = "#000000";

// Fixed-alpha canvas colors (built from component strings above)
const CLR_GLASS_FILL   = `hsla(${CHSL_BLUE_400}, 0.32)`;
const CLR_GLASS_BORDER = `hsla(${CHSL_BLUE_400}, 0.35)`;
const CLR_NORMAL_LINE  = `hsla(${CHSL_BLUE_400}, 0.30)`;
const CLR_ARC_STROKE   = `hsla(${CHSL_BLUE_400}, 0.55)`;
const CLR_LBL_MEDIUM   = `hsla(${CHSL_BLUE_400}, 0.55)`;
const CLR_LBL_GOLD     = `hsla(${CHSL_GOLD_500}, 0.75)`;
const CLR_LBL_RED     = `hsla(${CHSL_RED_500}, 0.90)`;
const CLR_LBL_WHITE    = `hsla(${CHSL_WHITE}, 0.80)`;
const CLR_LBL_THETA    = `hsla(${CHSL_WHITE}, 0.92)`;

// ============================================================
//  State
// ============================================================
let angle       = 65.0;
let lastResult  = { Rp: 0.8, Rs: 1.0, absorption: 0.2, field_intensity: 0.2 };
let isDragging       = false;
let isHoveringBeam   = false;
let fetchTimer  = null;
let scanWS      = null;
let scanData    = { angles: [], Rp: [], Rs: [], field: [], delta_s: [], delta_p: [] };
let chartReady  = false;
let chart2Ready = false;
let lookupTable = [];   // pre-computed dense angle scan for instant drag interpolation

// ============================================================
//  DOM references
// ============================================================
const canvas       = document.getElementById("diagram");
const ctx          = canvas.getContext("2d");

// ============================================================
//  Responsive canvas — fills #canvas-wrap width on every resize
// ============================================================
function resizeCanvas() {
  const w = canvas.parentElement.clientWidth;
  if (!w || w === CW) return;
  const s  = w / CW_BASE;
  CW       = w;
  CX       = w / 2;
  CH       = CH_BASE;
  CY       = CY_BASE;
  R        = R_BASE;
  GOLD_H   = GOLD_H_BASE;
  BEAM_EXT = Math.round(BEAM_EXT_BASE * s);
  canvas.width  = CW;
  canvas.height = CH;
  draw(angle, lastResult);
}
new ResizeObserver(resizeCanvas).observe(canvas.parentElement);

const angleDisplay = document.getElementById("angle-display");
const angleSlider  = document.getElementById("angle-slider");
const angleInput   = document.getElementById("angle-input");
const obsTheta     = document.getElementById("obs-theta");
const obsLam       = document.getElementById("obs-lam");
const rvRp         = document.getElementById("rv-rp");
const rvRs         = document.getElementById("rv-rs");
const rvAbs        = document.getElementById("rv-abs");
const btnScan      = document.getElementById("btn-scan");
const btnStop      = document.getElementById("btn-stop");
const btnExport    = document.getElementById("btn-export");
const scanStatus   = document.getElementById("scan-status");

// ============================================================
//  Plotly chart
// ============================================================
function chartColors() {
  const dark = document.documentElement.dataset.theme === "dark";
  const css  = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  return dark ? {
    paper: CLR_BLUE_800,
    plot:  CLR_BLUE_900,
    font:  CLR_WHITE,
    axis:  CLR_BLUE_400,
    grid:  CLR_BLUE_700,
  } : {
    paper: CLR_BLUE_800,
    plot:  CLR_WHITE,
    font:  CLR_BLACK,
    axis:  css("--text-dim"),
    grid:  CLR_BLUE_200,
  };
}

function initChart() {
  const c = chartColors();
  const layout = {
    paper_bgcolor: c.paper,
    plot_bgcolor:  c.plot,
    font:          { color: c.font, size: 11 },
    margin:        { t: 10, r: 20, b: 40, l: 50 },
    xaxis: {
      title: "Angle (°)",
      color: c.axis,
      gridcolor: c.grid,
      zeroline: false,
    },
    yaxis: {
      title: "Value",
      range: [-0.05, 1.05],
      color: c.axis,
      gridcolor: c.grid,
      zeroline: false,
    },
    legend: {
      x: 0.01, y: 0.99,
      bgcolor: "transparent",
      bordercolor: c.grid,
    },
    hovermode: "x unified",
    showlegend: true,
  };

  const traces = [
    { x: [], y: [], name: "Rp (p-pol)",      mode: "lines", line: { color: CLR_BLUE_400, width: 2 } },
    { x: [], y: [], name: "Rs (s-pol)",      mode: "lines", line: { color: CLR_RED_400,  width: 2 } },
    { x: [], y: [], name: "Absorption", mode: "lines", line: { color: CLR_GOLD_500, width: 2 } },
  ];

  Plotly.newPlot("charts", traces, layout, { responsive: true, displayModeBar: false });
  chartReady = true;
}

function initChart2() {
  const c = chartColors();
  const layout = {
    paper_bgcolor: c.paper,
    plot_bgcolor:  c.plot,
    font:          { color: c.font, size: 11 },
    margin:        { t: 10, r: 20, b: 40, l: 50 },
    xaxis: {
      title: "Angle (°)",
      color: c.axis,
      gridcolor: c.grid,
      zeroline: false,
    },
    yaxis: {
      title: "Phase (°)",
      range: [-185, 185],
      color: c.axis,
      gridcolor: c.grid,
      zeroline: true,
      zerolinecolor: c.grid,
    },
    legend: {
      x: 0.01, y: 0.99,
      bgcolor: "transparent",
      bordercolor: c.grid,
    },
    hovermode: "x unified",
    showlegend: true,
  };

  const traces = [
    { x: [], y: [], name: "δp − δs", mode: "lines", line: { color: CLR_BLUE_400, width: 2 } },
  ];

  Plotly.newPlot("charts2", traces, layout, { responsive: true, displayModeBar: false });
  chart2Ready = true;
}

function resetChart() {
  scanData = { angles: [], Rp: [], Rs: [], field: [], delta_s: [], delta_p: [] };
  if (chartReady)  Plotly.restyle("charts",  { x: [[], [], []], y: [[], [], []] }, [0, 1, 2]);
  if (chart2Ready) Plotly.restyle("charts2", { x: [[]], y: [[]] }, [0]);
}

/* Pre-set chart2 y-axis range using the lookup table so the axis fits
   the data before streaming begins. Restricted to the scan angle window. */
function setChart2RangeFromLookup() {
  if (!chart2Ready || !lookupTable.length) return;
  const amin = parseFloat(_paramVal("scan-min"));
  const amax = parseFloat(_paramVal("scan-max"));
  const subset = lookupTable.filter(r => r.angle >= amin && r.angle <= amax);
  if (!subset.length) return;

  // Unwrap delta_s and delta_p, then compute their difference
  const ds = unwrap(subset.map(r => r.delta_s));
  const dp = unwrap(subset.map(r => r.delta_p));
  const diff = dp.map((v, i) => v - ds[i]);
  const lo = Math.min(...diff);
  const hi = Math.max(...diff);
  const pad = Math.max((hi - lo) * 0.08, 5);   // 8 % padding, minimum 5°

  Plotly.relayout("charts2", { "yaxis.range": [lo - pad, hi + pad], "yaxis.autorange": false });
}

function appendChartPoint(a, res) {
  scanData.angles.push(a);
  scanData.Rp.push(res.Rp);
  scanData.Rs.push(res.Rs);
  scanData.field.push(res.field_intensity);
  scanData.delta_s.push(res.delta_s);
  scanData.delta_p.push(res.delta_p);

  if (chartReady) {
    Plotly.extendTraces(
      "charts",
      { x: [[a], [a], [a]], y: [[res.Rp], [res.Rs], [res.field_intensity]] },
      [0, 1, 2]
    );
  }
  if (chart2Ready) {
    Plotly.extendTraces(
      "charts2",
      { x: [[a]], y: [[res.delta_p - res.delta_s]] },
      [0]
    );
  }
}

// ============================================================
//  Drawing
// ============================================================

function draw(theta_deg, result) {
  const fi = result.field_intensity;  // [0, 1]
  const Rp = result.Rp;

  ctx.clearRect(0, 0, CW, CH);

  drawBackground();
  drawTopMediumGlow(fi);
  drawGlass();
  drawGoldLayer(fi);
  drawNormal();
  drawAngleArc(theta_deg);
  drawLaserBeam(theta_deg, Rp, isDragging || isHoveringBeam);
  drawLabels(theta_deg);
}

function canvasBgColors() {
  const dark = document.documentElement.dataset.theme === "dark";
  return dark
    ? { full: CLR_BLUE_900, topMedium: CLR_BLUE_800 }
    : { full: CLR_BLUE_600, topMedium: CLR_BLUE_900 };
}

function drawBackground() {
  const bg = canvasBgColors();
  ctx.fillStyle = bg.full;
  ctx.fillRect(0, 0, CW, CH);
  // Top medium zone (above gold layer)
  ctx.fillStyle = bg.topMedium;
  ctx.fillRect(0, 0, CW, CY - GOLD_H);
}

function drawTopMediumGlow(fi) {
  if (fi < 0.02) return;

  // Diffuse glow spreading from the gold layer upward
  const glowH = 120 * fi;
  const grad = ctx.createLinearGradient(0, CY - GOLD_H, 0, CY - GOLD_H - glowH);
  grad.addColorStop(0,   `hsla(${CHSL_GOLD_500}, ${fi * 0.45})`);
  grad.addColorStop(0.4, `hsla(${CHSL_GOLD_700}, ${fi * 0.15})`);
  grad.addColorStop(1,   `hsla(${CHSL_GOLD_700}, 0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, CY - GOLD_H - glowH, CW, glowH);

  // Bright core strip right above the gold
  const coreH = 14 * fi;
  const coreGrad = ctx.createLinearGradient(0, CY - GOLD_H, 0, CY - GOLD_H - coreH);
  coreGrad.addColorStop(0, `hsla(${CHSL_GOLD_500}, ${fi * 0.7})`);
  coreGrad.addColorStop(1, `hsla(${CHSL_GOLD_500}, 0)`);
  ctx.fillStyle = coreGrad;
  ctx.fillRect(0, CY - GOLD_H - coreH, CW, coreH);
}

function drawGlass() {
  ctx.save();

  // Fill
  ctx.beginPath();
  ctx.moveTo(CX - R, CY);
  ctx.lineTo(CX + R, CY);
  ctx.arc(CX, CY, R, 0, Math.PI);   // 0→π draws the bottom half-circle
  ctx.closePath();
  ctx.fillStyle = CLR_GLASS_FILL;
  ctx.fill();

  // Curved border
  ctx.beginPath();
  ctx.arc(CX, CY, R, 0, Math.PI);
  ctx.strokeStyle = CLR_GLASS_BORDER;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();
}

function drawGoldLayer(fi) {
  ctx.save();

  // Glow shadow on the gold rect itself
  ctx.shadowColor = `hsla(${CHSL_GOLD_500}, ${fi * 0.9})`;
  ctx.shadowBlur  = 18 + fi * 30;

  // Gold rectangle (sits on top of the flat face)
  const grad = ctx.createLinearGradient(0, CY - GOLD_H, 0, CY);
  grad.addColorStop(0, CLR_GOLD_550);
  grad.addColorStop(1, CLR_GOLD_800);
  ctx.fillStyle = grad;
  ctx.fillRect(CX - R, CY - GOLD_H, 2 * R, GOLD_H);

  ctx.shadowBlur = 0;

  // Thin bright top edge
  ctx.strokeStyle = `hsla(${CHSL_GOLD_500}, ${0.4 + fi * 0.5})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(CX - R, CY - GOLD_H);
  ctx.lineTo(CX + R, CY - GOLD_H);
  ctx.stroke();

  ctx.restore();
}

function drawNormal() {
  // Dashed vertical normal line at the hit point
  ctx.save();
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = CLR_NORMAL_LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(CX, CY - GOLD_H - 60);
  ctx.lineTo(CX, CY + 60);
  ctx.stroke();
  ctx.restore();
}

function drawAngleArc(theta_deg) {
  if (theta_deg < 2) return;
  const theta = (theta_deg * Math.PI) / 180;
  const arcR  = Math.round(R * 0.3);   // scales with prism radius

  ctx.save();
  ctx.strokeStyle = CLR_ARC_STROKE;
  ctx.lineWidth = 1.5;

  // Arc between normal and the incident beam direction
  const normalAngle = Math.PI / 2;
  const beamAngle   = Math.PI / 2 + theta;

  ctx.beginPath();
  ctx.arc(CX, CY, arcR, normalAngle, beamAngle, false);
  ctx.stroke();

  // θ label
  const midAngle = (normalAngle + beamAngle) / 2;
  const lx = CX + (arcR + 12) * Math.cos(midAngle);
  const ly = CY + (arcR + 12) * Math.sin(midAngle);
  ctx.fillStyle = CLR_LBL_THETA;
  ctx.font = "bold 13px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("θ", lx, ly);

  ctx.restore();
}

function drawLaserBeam(theta_deg, Rp, grabbed = false) {
  const theta = (theta_deg * Math.PI) / 180;

  // Incident beam entry point on the curved surface
  const ex = CX - R * Math.sin(theta);
  const ey = CY + R * Math.cos(theta);

  // Extended source (outside the glass)
  const sx = ex - BEAM_EXT * Math.sin(theta);
  const sy = ey + BEAM_EXT * Math.cos(theta);

  // Reflected exit point on the curved surface
  const rx = CX + R * Math.sin(theta);
  const ry = CY + R * Math.cos(theta);

  // Extended reflected ray (outside the glass)
  const rx2 = rx + BEAM_EXT * Math.sin(theta);
  const ry2 = ry + BEAM_EXT * Math.cos(theta);

  ctx.save();

  // --- Incident beam ---
  const beamHSL   = grabbed ? CHSL_RED_400 : CHSL_RED_500;
  const beamAlpha = grabbed ? 0.9 : 0.6;
  ctx.shadowColor = `hsla(${beamHSL}, ${beamAlpha})`;
  ctx.shadowBlur  = grabbed ? 18 : 8;
  ctx.strokeStyle = `hsl(${beamHSL})`;
  ctx.lineWidth   = grabbed ? 3.5 : 2.5;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(CX, CY);
  ctx.stroke();

  ctx.shadowBlur = 0;

  // --- Reflected beam ---
  const reflAlpha = 0.35 + Rp * 0.65;  // dimmer at resonance
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = `hsla(${CHSL_RED_400}, ${reflAlpha})`;
  ctx.lineWidth   = 2;
  ctx.shadowColor = `hsla(${CHSL_RED_500}, ${reflAlpha * 0.5})`;
  ctx.shadowBlur  = 5;
  ctx.beginPath();
  ctx.moveTo(CX, CY);
  ctx.lineTo(rx2, ry2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;

  // --- Arrow on reflected ray tip ---
  const L = 15, W = 5;
  ctx.translate(rx2, ry2);
  ctx.rotate(Math.PI / 2 - theta);
  ctx.fillStyle = `hsl(${beamHSL})`;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-L, W);
  ctx.lineTo(-L, -W);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawLabels(theta_deg) {
  const fontSize = 16;
  ctx.save();
  ctx.font = `${fontSize}px 'Segoe UI', sans-serif`;

  // Top medium label
  ctx.fillStyle = CLR_LBL_MEDIUM;
  ctx.textAlign = "left";
  ctx.fillText("Top medium (n = " + _paramVal("top-n") + ")", 10, 16);

  // Gold label
  ctx.fillStyle = CLR_LBL_GOLD;
  ctx.textAlign = "left";
  ctx.fillText("Au  " + _paramVal("gold-nm") + " nm", 10, CY - GOLD_H - 5);

  // Glass label (inside half-disk)
  ctx.fillStyle = CLR_LBL_WHITE;
  ctx.textAlign = "center";
  ctx.fillText("Glass  n = " + _paramVal("prism-n"), CX, CY + R * 0.75);

  // λ label (bottom-right)
  ctx.fillStyle = CLR_LBL_GOLD;
  ctx.textAlign = "right";
  ctx.fillText("λ = " + _paramVal("lam-nm") + " nm", CW - 8, CH - 6);

  ctx.restore();
}

function _paramVal(id) {
  return document.getElementById(id).value;
}

// ============================================================
//  API
// ============================================================
async function fetchCalculate(a) {
  const params = new URLSearchParams({
    angle:   a.toFixed(2),
    lam_nm:  _paramVal("lam-nm"),
    gold_nm: _paramVal("gold-nm"),
    top_n:   _paramVal("top-n"),
    prism_n: _paramVal("prism-n"),
  });
  try {
    const resp = await fetch(`${API}/api/calculate?${params}`);
    return await resp.json();
  } catch (e) {
    console.warn("fetch failed:", e);
    return lastResult;
  }
}

function updateReadout(result) {
  rvRp.textContent  = result.Rp.toFixed(3);
  rvRs.textContent  = result.Rs.toFixed(3);
  rvAbs.textContent = result.absorption.toFixed(3);
}

// ============================================================
//  Lookup table — built once on load, rebuilt on param change
// ============================================================
async function buildLookupTable() {
  const params = new URLSearchParams({
    angle_min: 0, angle_max: 89.5, n_steps: 250,
    lam_nm:  _paramVal("lam-nm"),
    gold_nm: _paramVal("gold-nm"),
    top_n:   _paramVal("top-n"),
    prism_n: _paramVal("prism-n"),
  });
  try {
    const resp = await fetch(`${API}/api/lookup?${params}`);
    lookupTable = await resp.json();
  } catch (e) {
    console.warn("lookup fetch failed:", e);
    lookupTable = [];
  }
}

function interpolateResult(a) {
  const n = lookupTable.length;
  if (!n) return lastResult;
  if (a <= lookupTable[0].angle)   return lookupTable[0];
  if (a >= lookupTable[n-1].angle) return lookupTable[n-1];
  // Linear scan — 250 points, negligible cost
  for (let i = 0; i < n - 1; i++) {
    const lo = lookupTable[i], hi = lookupTable[i + 1];
    if (a >= lo.angle && a <= hi.angle) {
      const t = (a - lo.angle) / (hi.angle - lo.angle);
      return {
        angle:           a,
        Rp:              lo.Rp              + t * (hi.Rp              - lo.Rp),
        Rs:              lo.Rs              + t * (hi.Rs              - lo.Rs),
        absorption:      lo.absorption      + t * (hi.absorption      - lo.absorption),
        field_intensity: lo.field_intensity + t * (hi.field_intensity - lo.field_intensity),
      };
    }
  }
  return lastResult;
}

// ============================================================
//  Angle update
// ============================================================
function setAngleUI(a) {
  angle = Math.max(0, Math.min(90, a));
  const disp = angle.toFixed(1);
  angleDisplay.textContent = disp;
  obsTheta.textContent     = disp;
  angleSlider.value = angle;
  angleInput.value  = disp;
  // Instant visual update from lookup table — no HTTP round-trip
  const result = interpolateResult(angle);
  lastResult = result;
  draw(angle, result);
  updateReadout(result);
}

function scheduleFetch(a) {
  if (fetchTimer) clearTimeout(fetchTimer);
  fetchTimer = setTimeout(async () => {
    const result = await fetchCalculate(a);
    lastResult = result;
    updateReadout(result);
    draw(a, result);
  }, 80);
}

// ============================================================
//  Hit-test helpers
// ============================================================

// Perpendicular distance from point P to segment AB
function _distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Returns true when (mx, my) is within HIT_PX of the incident beam
const HIT_PX = 12;
function _nearIncidentBeam(mx, my) {
  const theta = (angle * Math.PI) / 180;
  const ex = CX - R * Math.sin(theta);
  const ey = CY + R * Math.cos(theta);
  const sx = ex - BEAM_EXT * Math.sin(theta);
  const sy = ey + BEAM_EXT * Math.cos(theta);
  return _distToSegment(mx, my, sx, sy, CX, CY) < HIT_PX;
}

function _canvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    mx: (e.clientX - rect.left) * (CW / rect.width),
    my: (e.clientY - rect.top)  * (CH / rect.height),
  };
}

// ============================================================
//  Mouse drag on canvas
// ============================================================
canvas.addEventListener("mousedown", (e) => {
  const { mx, my } = _canvasCoords(e);
  if (_nearIncidentBeam(mx, my)) {
    isDragging = true;
    canvas.style.cursor = "grabbing";
    angleFromCursor(mx, my);
  }
});

canvas.addEventListener("mousemove", (e) => {
  const { mx, my } = _canvasCoords(e);
  if (isDragging) {
    angleFromCursor(mx, my);
    return;
  }
  // Hover highlight
  const near = _nearIncidentBeam(mx, my);
  if (near !== isHoveringBeam) {
    isHoveringBeam = near;
    canvas.style.cursor = near ? "grab" : "default";
    draw(angle, lastResult);
  }
});

canvas.addEventListener("mouseup", () => {
  if (isDragging) {
    isDragging = false;
    canvas.style.cursor = isHoveringBeam ? "grab" : "default";
  }
});

canvas.addEventListener("mouseleave", () => {
  isDragging     = false;
  isHoveringBeam = false;
  canvas.style.cursor = "default";
  draw(angle, lastResult);
});

// Touch support
canvas.addEventListener("touchstart", (e) => {
  if (!e.touches.length) return;
  const rect = canvas.getBoundingClientRect();
  const mx = (e.touches[0].clientX - rect.left) * (CW / rect.width);
  const my = (e.touches[0].clientY - rect.top)  * (CH / rect.height);
  if (_nearIncidentBeam(mx, my)) {
    isDragging = true;
    angleFromCursor(mx, my);
  }
}, { passive: true });

canvas.addEventListener("touchmove", (e) => {
  if (!isDragging || !e.touches.length) return;
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = (e.touches[0].clientX - rect.left) * (CW / rect.width);
  const my = (e.touches[0].clientY - rect.top)  * (CH / rect.height);
  angleFromCursor(mx, my);
}, { passive: false });

canvas.addEventListener("touchend", () => { isDragging = false; });

function handleMouse(e) {
  const { mx, my } = _canvasCoords(e);
  angleFromCursor(mx, my);
}

function handleTouch(e) {
  if (!e.touches.length) return;
  const rect  = canvas.getBoundingClientRect();
  const mx = (e.touches[0].clientX - rect.left) * (CW / rect.width);
  const my = (e.touches[0].clientY - rect.top)  * (CH / rect.height);
  angleFromCursor(mx, my);
}

function angleFromCursor(mx, my) {
  const dy = my - CY;
  if (dy <= 0) return;   // cursor is above or on the flat face — nothing to do
  const theta = Math.atan2(Math.abs(CX - mx), dy) * (180 / Math.PI);
  if (!isNaN(theta)) setAngleUI(theta);
}

// ============================================================
//  Angle controls (slider + number input)
// ============================================================
angleSlider.addEventListener("input", () => {
  setAngleUI(parseFloat(angleSlider.value));
});

angleInput.addEventListener("change", () => {
  const v = parseFloat(angleInput.value);
  if (!isNaN(v)) setAngleUI(v);
});

// Rebuild lookup table when physics params change, then redraw
["lam-nm", "gold-nm", "prism-n", "top-n"].forEach((id) => {
  document.getElementById(id).addEventListener("change", async () => {
    if (id === "lam-nm") obsLam.textContent = _paramVal("lam-nm");
    await buildLookupTable();
    setAngleUI(angle);
  });
});

// ============================================================
//  Scan
// ============================================================
btnScan.addEventListener("click", startScan);
btnStop.addEventListener("click", stopScan);

function startScan() {
  if (scanWS) return;

  resetChart();
  setChart2RangeFromLookup();
  btnScan.style.display = "none";
  btnStop.style.display = "block";
  btnExport.style.display = "none";
  scanStatus.textContent = "Scanning…";

  const wsProto = location.protocol === "https:" ? "wss" : "ws";
  const wsURL = (API.startsWith("http")
    ? API.replace(/^http/, "ws")
    : `${wsProto}://${location.host}`) + "/ws/scan";

  scanWS = new WebSocket(wsURL);

  scanWS.onopen = () => {
    scanWS.send(JSON.stringify({
      angle_min:  parseFloat(_paramVal("scan-min")),
      angle_max:  parseFloat(_paramVal("scan-max")),
      n_steps:    parseInt(_paramVal("scan-steps")),
      lam_nm:     parseFloat(_paramVal("lam-nm")),
      gold_nm:    parseFloat(_paramVal("gold-nm")),
      top_n:      parseFloat(_paramVal("top-n")),
      prism_n:    parseFloat(_paramVal("prism-n")),
      duration_s: 4.0,
    }));
  };

  scanWS.onmessage = (evt) => {
    const data = JSON.parse(evt.data);

    if (data.done) {
      finishScan("Scan complete.");
      return;
    }
    if (data.error) {
      finishScan("Error: " + data.error);
      return;
    }

    // Animate beam and update display
    lastResult = data;
    angle = data.angle;
    angleDisplay.textContent = angle.toFixed(1);
    angleSlider.value = angle;
    angleInput.value  = angle.toFixed(1);
    draw(data.angle, data);
    updateReadout(data);
    appendChartPoint(data.angle, data);
  };

  scanWS.onerror = () => finishScan("WebSocket error.");
  scanWS.onclose = () => {
    if (scanWS) finishScan("");
  };
}

function stopScan() {
  if (scanWS) {
    scanWS.send("stop");
    scanWS.close();
    scanWS = null;
  }
  finishScan("Scan stopped.");
}

function finishScan(msg) {
  scanWS = null;
  btnStop.style.display = "none";
  btnScan.style.display = "block";
  scanStatus.textContent = msg;
  if (scanData.angles.length) btnExport.style.display = "block";
}

// ============================================================
//  Export
// ============================================================
function unwrap(phases) {
  const result = [...phases];
  for (let i = 1; i < result.length; i++) {
    let diff = result[i] - result[i - 1];
    while (diff >  180) diff -= 360;
    while (diff < -180) diff += 360;
    result[i] = result[i - 1] + diff;
  }
  return result;
}

function exportTSV() {
  const exportStatus = document.getElementById("export-status");
  if (!scanData.angles.length) {
    exportStatus.textContent = "No scan data.";
    return;
  }
  const ds = unwrap(scanData.delta_s);
  const dp = unwrap(scanData.delta_p);
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const lines = [
    `# SPR Simulator — Scan Results`,
    `# Date: ${now}`,
    `# Wavelength: ${_paramVal("lam-nm")} nm`,
    `# Gold thickness: ${_paramVal("gold-nm")} nm`,
    `# Prism n: ${_paramVal("prism-n")}`,
    `# Top medium n: ${_paramVal("top-n")}`,
    `# Angle range: ${scanData.angles[0].toFixed(1)}° – ${scanData.angles[scanData.angles.length - 1].toFixed(1)}°, ${scanData.angles.length} steps`,
    `# Angle (deg.)\tRs\tRp\tdelta_s (deg.)\tdelta_p (deg.)\tAbsorption`,
  ];
  for (let i = 0; i < scanData.angles.length; i++) {
    lines.push([
      scanData.angles[i].toFixed(4),
      scanData.Rs[i].toFixed(6),
      scanData.Rp[i].toFixed(6),
      ds[i].toFixed(4),
      dp[i].toFixed(4),
      scanData.field[i].toFixed(6),
    ].join("\t"));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/tab-separated-values" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `spr_scan_${now.replace(/[: ]/g, "-")}.tsv`;
  a.click();
  URL.revokeObjectURL(url);
  exportStatus.textContent = `Exported ${scanData.angles.length} points.`;
}

// ============================================================
//  Init
// ============================================================
initChart();
initChart2();

// Export
document.getElementById("btn-export").addEventListener("click", exportTSV);

// Theme toggle
document.getElementById("theme-toggle").addEventListener("click", () => {
  const html = document.documentElement;
  const next = html.dataset.theme === "dark" ? "light" : "dark";
  html.dataset.theme = next;
  document.getElementById("theme-toggle").textContent = next === "dark" ? "☀" : "☽";
  if (chartReady || chart2Ready) {
    const c = chartColors();
    const update = {
      paper_bgcolor: c.paper,
      plot_bgcolor:  c.plot,
      "font.color":  c.font,
      "xaxis.color": c.axis, "xaxis.gridcolor": c.grid,
      "yaxis.color": c.axis, "yaxis.gridcolor": c.grid,
      "legend.bordercolor": c.grid,
    };
    if (chartReady)  Plotly.relayout("charts",  update);
    if (chart2Ready) Plotly.relayout("charts2", update);
  }
});

// Build lookup table, then draw initial state
obsLam.textContent = _paramVal("lam-nm");
(async () => {
  await buildLookupTable();
  setAngleUI(angle);
})();
