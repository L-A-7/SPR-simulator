"use strict";

// ============================================================
//  Configuration
// ============================================================
const API = "";           // same origin — change to "http://localhost:8000" for dev

// ============================================================
//  Canvas geometry — base values at reference width CW_BASE
//  All variables are updated proportionally by resizeCanvas().
// ============================================================
const CW_BASE    = 700;   // reference canvas width
const CH_BASE    = 279;   // reference canvas height — CH = CY + (old CH − old CY)
const CY_BASE    = 109;   // y of flat face — top medium = (CY−GOLD_H)/2 of original
const R_BASE     = 140;   // half-disk radius at reference size (was 120)
const GOLD_H_BASE  =  8;  // visual gold thickness at reference (was 7)
const BEAM_EXT_BASE = 80; // beam extension outside disk at reference (was 70)

let CW       = CW_BASE;
let CH       = CH_BASE;
let CX       = CW / 2;
let CY       = CY_BASE;
let R        = R_BASE;
let GOLD_H   = GOLD_H_BASE;
let BEAM_EXT = BEAM_EXT_BASE;

// ============================================================
//  State
// ============================================================
let angle       = 65.0;   // current incidence angle (degrees)
let lastResult  = { Rp: 0.8, Rs: 1.0, absorption: 0.2, field_intensity: 0.2 };
let isDragging       = false;
let isHoveringBeam   = false;
let fetchTimer  = null;
let scanWS      = null;
let scanData    = { angles: [], Rp: [], Rs: [], field: [] };
let chartReady  = false;
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
  CH       = Math.round(CH_BASE    * s);
  CX       = w / 2;
  CY       = Math.round(CY_BASE    * s);
  R        = Math.round(R_BASE     * s);
  GOLD_H   = Math.max(2, Math.round(GOLD_H_BASE   * s));
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
const rvField      = document.getElementById("rv-field");
const btnScan      = document.getElementById("btn-scan");
const btnStop      = document.getElementById("btn-stop");
const scanStatus   = document.getElementById("scan-status");

// ============================================================
//  Plotly chart
// ============================================================
function chartColors() {
  const dark = document.documentElement.dataset.theme === "dark";
  const css  = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  return dark ? {
    paper: "hsl(204, 70%, 27%)",    /* --blue-800 = --bg-deep  */
    plot:  "hsl(204, 72%, 18%)",    /* --blue-900              */
    font:  "#ffffff",               /* --text-on-deep          */
    axis:  "hsl(204, 68%, 55%)",    /* --blue-400              */
    grid:  "hsl(204, 70%, 31%)",    /* --blue-700              */
  } : {
    paper: "hsl(204, 70%, 27%)",    /* --blue-800 — border area */
    plot:  "#ffffff",               /* white inner plot         */
    font:  "#000000",               /* black on white plot      */
    axis:  css("--text-dim"),       /* mirrors CSS --text-dim   */
    grid:  "hsl(204, 60%, 82%)",    /* --blue-200               */
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
    { x: [], y: [], name: "Rp (p-pol)",     mode: "lines", line: { color: "hsl(204, 68%, 55%)", width: 2 } },  /* --blue-400 */
    { x: [], y: [], name: "Rs (s-pol)",     mode: "lines", line: { color: "hsl(0,  100%, 71%)", width: 2 } },  /* --red-400  */
    { x: [], y: [], name: "Field intensity",mode: "lines", line: { color: "hsl(44,  90%, 50%)", width: 2 } },  /* --gold-500 */
  ];

  Plotly.newPlot("charts", traces, layout, { responsive: true, displayModeBar: false });
  chartReady = true;
}

function resetChart() {
  scanData = { angles: [], Rp: [], Rs: [], field: [] };
  if (!chartReady) return;
  Plotly.restyle("charts", { x: [[], [], []], y: [[], [], []] }, [0, 1, 2]);
}

function appendChartPoint(a, res) {
  scanData.angles.push(a);
  scanData.Rp.push(res.Rp);
  scanData.Rs.push(res.Rs);
  scanData.field.push(res.field_intensity);

  if (!chartReady) return;
  Plotly.extendTraces(
    "charts",
    {
      x: [[a], [a], [a]],
      y: [[res.Rp], [res.Rs], [res.field_intensity]],
    },
    [0, 1, 2]
  );
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
  return dark ? {
    full:      "hsl(204, 72%, 18%)", /* --blue-900 — prism zone  */
    topMedium: "hsl(204, 70%, 27%)", /* --blue-800 — medium zone */
  } : {
    full:      "hsl(204, 73%, 34%)", /* --blue-600 — prism zone  */
    topMedium: "hsl(204, 72%, 18%)", /* --blue-900 — medium zone             */
  };
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

  // Diffuse horizontal glow spreading from the gold layer upward
  const glowH = 120 * fi;
  const grad = ctx.createLinearGradient(0, CY - GOLD_H, 0, CY - GOLD_H - glowH);
  grad.addColorStop(0,   `hsla(44, 90%, 50%, ${fi * 0.45})`);  /* --gold-500 */
  grad.addColorStop(0.4, `hsla(44, 88%, 38%, ${fi * 0.15})`);  /* --gold-700 */
  grad.addColorStop(1,   "hsla(44, 88%, 38%, 0)");

  ctx.fillStyle = grad;
  ctx.fillRect(0, CY - GOLD_H - glowH, CW, glowH);

  // Bright core strip right above the gold
  const coreH = 14 * fi;
  const coreGrad = ctx.createLinearGradient(0, CY - GOLD_H, 0, CY - GOLD_H - coreH);
  coreGrad.addColorStop(0, `hsla(44, 90%, 50%, ${fi * 0.7})`);  /* --gold-500 */
  coreGrad.addColorStop(1, "hsla(44, 90%, 50%, 0)");
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
  ctx.fillStyle = "hsla(204, 68%, 55%, 0.32)";  /* --blue-400 */
  ctx.fill();

  // Curved border
  ctx.beginPath();
  ctx.arc(CX, CY, R, 0, Math.PI);
  ctx.strokeStyle = "hsla(204, 68%, 55%, 0.35)";  /* --blue-400 */
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();
}

function drawGoldLayer(fi) {
  ctx.save();

  // Glow shadow on the gold rect itself
  ctx.shadowColor = `hsla(44, 90%, 50%, ${fi * 0.9})`;  /* --gold-500 */
  ctx.shadowBlur  = 18 + fi * 30;

  // Gold rectangle (sits on top of the flat face)
  const grad = ctx.createLinearGradient(0, CY - GOLD_H, 0, CY);
  grad.addColorStop(0, "hsl(44, 90%, 46%)");   /* --gold-550 */
  grad.addColorStop(1, "hsl(44, 88%, 32%)");   /* --gold-800 */
  ctx.fillStyle = grad;
  ctx.fillRect(CX - R, CY - GOLD_H, 2 * R, GOLD_H);

  ctx.shadowBlur = 0;

  // Thin bright top edge
  ctx.strokeStyle = `hsla(44, 90%, 50%, ${0.4 + fi * 0.5})`;  /* --gold-500 */
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
  ctx.strokeStyle = "hsla(204, 68%, 55%, 0.3)";  /* --blue-400 */
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
  ctx.strokeStyle = "hsla(204, 68%, 55%, 0.55)";  /* --blue-400 */
  ctx.lineWidth = 1.5;

  // Arc between normal (up = −π/2) and the incident beam direction
  // Normal points up → angle −π/2 in canvas.
  // Incident beam comes from lower-left, direction toward CX,CY.
  // Beam direction from hit point going down-left: angle = π/2 + θ  (from +x axis, CW)
  // Arc from −π/2 (up/normal) to  π/2 + θ going clockwise (increasing angle)
  const normalAngle = -Math.PI / 2;        // pointing up in canvas
  const beamAngle   = Math.PI / 2 + theta; // pointing down-left

  ctx.beginPath();
  ctx.arc(CX, CY, arcR, normalAngle, beamAngle, false);
  ctx.stroke();

  // θ label
  const midAngle = (normalAngle + beamAngle) / 2;
  const lx = CX + (arcR + 12) * Math.cos(midAngle);
  const ly = CY + (arcR + 12) * Math.sin(midAngle);
  ctx.fillStyle = "hsla(0, 0%, 100%, 0.92)";   /* white — high contrast for θ */
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
  const beamColor = grabbed ? "hsl(0, 100%, 71%)" : "hsl(0, 100%, 63%)";  /* --red-400 / --red-500 */
  ctx.shadowColor = grabbed ? "hsla(0, 100%, 71%, 0.9)" : "hsla(0, 100%, 63%, 0.6)";
  ctx.shadowBlur  = grabbed ? 18 : 8;
  ctx.strokeStyle = beamColor;
  ctx.lineWidth   = grabbed ? 3.5 : 2.5;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(CX, CY);
  ctx.stroke();

  // Arrow head at the hit point
  _arrowHead(CX, CY, theta + Math.PI, beamColor);


  ctx.shadowBlur = 0;

  // --- Reflected beam ---
  const reflAlpha = 0.35 + Rp * 0.65;  // dimmer at resonance
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = `hsla(0, 100%, 71%, ${reflAlpha})`;   /* --red-400 */
  ctx.lineWidth   = 2;
  ctx.shadowColor = `hsla(0, 100%, 63%, ${reflAlpha * 0.5})`;  /* --red-500 */
  ctx.shadowBlur  = 5;
  ctx.beginPath();
  ctx.moveTo(CX, CY);
  ctx.lineTo(rx2, ry2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;

  ctx.restore();
}

function _arrowHead(x, y, dir, color) {
  const L = 10, W = 5;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(dir);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-L, W);
  ctx.lineTo(-L, -W);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawLabels(theta_deg) {
  ctx.save();
  ctx.font = "12px 'Segoe UI', sans-serif";

  // Top medium label — upper part of the top-medium zone
  ctx.fillStyle = "hsla(204, 68%, 55%, 0.55)";  /* --blue-400 */
  ctx.textAlign = "left";
  ctx.fillText("Top medium (n = " + _paramVal("top-n") + ")", 10, 16);

  // Gold label
  ctx.fillStyle = "hsla(44, 90%, 50%, 0.75)";   /* --gold-500 */
  ctx.textAlign = "left";
  ctx.fillText("Au  " + _paramVal("gold-nm") + " nm", 10, CY - GOLD_H - 5);

  // Glass label (inside half-disk)
  ctx.fillStyle = "hsla(0, 0%, 100%, 0.80)";    /* white — better contrast */
  ctx.textAlign = "center";
  ctx.fillText("Glass  n = " + _paramVal("prism-n"), CX, CY + R * 0.5);

  // λ label (bottom-right of diagram)
  ctx.fillStyle = "hsla(204, 68%, 55%, 0.4)";   /* --blue-400 */
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
  rvRp.textContent    = result.Rp.toFixed(3);
  rvRs.textContent    = result.Rs.toFixed(3);
  rvAbs.textContent   = result.absorption.toFixed(3);
  rvField.textContent = result.field_intensity.toFixed(3);
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
  angle = Math.max(5, Math.min(85, a));
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
  const scaleX = CW / rect.width;
  const scaleY = CH / rect.height;
  const mx = (e.touches[0].clientX - rect.left) * scaleX;
  const my = (e.touches[0].clientY - rect.top)  * scaleY;
  angleFromCursor(mx, my);
}

function angleFromCursor(mx, my) {
  // dy is positive when the cursor is below the flat face (inside the glass)
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
  btnScan.style.display = "none";
  btnStop.style.display = "block";
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
}

// ============================================================
//  Init
// ============================================================
initChart();

// Theme toggle
document.getElementById("theme-toggle").addEventListener("click", () => {
  const html = document.documentElement;
  const next = html.dataset.theme === "dark" ? "light" : "dark";
  html.dataset.theme = next;
  document.getElementById("theme-toggle").textContent = next === "dark" ? "☀" : "☽";
  if (chartReady) {
    const c = chartColors();
    Plotly.relayout("charts", {
      paper_bgcolor: c.paper,
      plot_bgcolor:  c.plot,
      "font.color":  c.font,
      "xaxis.color": c.axis, "xaxis.gridcolor": c.grid,
      "yaxis.color": c.axis, "yaxis.gridcolor": c.grid,
      "legend.bordercolor": c.grid,
    });
  }
});

// Build lookup table, then draw initial state
obsLam.textContent = _paramVal("lam-nm");
(async () => {
  await buildLookupTable();
  setAngleUI(angle);
})();
