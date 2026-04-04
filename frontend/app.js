"use strict";

// ============================================================
//  Configuration
// ============================================================
const API = "";           // same origin — change to "http://localhost:8000" for dev

// ============================================================
//  Canvas geometry (logical px — CSS scales the element)
// ============================================================
const CW      = 700;      // canvas logical width
const CH      = 430;      // canvas logical height
const CX      = CW / 2;  // centre of the flat face (hit point of the beam)
const CY      = 290;      // y of the flat face
const R       = 195;      // half-disk radius
const GOLD_H  = 7;        // visual gold thickness (px)
const BEAM_EXT = 70;      // how far the beam extends outside the disk

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
const angleDisplay = document.getElementById("angle-display");
const angleSlider  = document.getElementById("angle-slider");
const angleInput   = document.getElementById("angle-input");
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
function initChart() {
  const layout = {
    paper_bgcolor: "#111827",
    plot_bgcolor:  "#0d1526",
    font:          { color: "#c8d8f0", size: 11 },
    margin:        { t: 10, r: 20, b: 40, l: 50 },
    xaxis: {
      title: "Angle (°)",
      color: "#5a6a88",
      gridcolor: "#1e2d45",
      zeroline: false,
    },
    yaxis: {
      title: "Value",
      range: [-0.05, 1.05],
      color: "#5a6a88",
      gridcolor: "#1e2d45",
      zeroline: false,
    },
    legend: {
      x: 0.01, y: 0.99,
      bgcolor: "rgba(0,0,0,0)",
      bordercolor: "#1e2d45",
    },
    hovermode: "x unified",
    showlegend: true,
  };

  const traces = [
    { x: [], y: [], name: "Rp (p-pol)",        mode: "lines", line: { color: "#4af0ff", width: 2 } },
    { x: [], y: [], name: "Rs (s-pol)",         mode: "lines", line: { color: "#ff6b6b", width: 2 } },
    { x: [], y: [], name: "Field intensity",    mode: "lines", line: { color: "#ffd700", width: 2 } },
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

function drawBackground() {
  // Full background
  ctx.fillStyle = "#08101e";
  ctx.fillRect(0, 0, CW, CH);

  // Top medium zone (above gold)
  ctx.fillStyle = "#0b1a30";
  ctx.fillRect(0, 0, CW, CY - GOLD_H);
}

function drawTopMediumGlow(fi) {
  if (fi < 0.02) return;

  // Diffuse horizontal glow spreading from the gold layer upward
  const glowH = 120 * fi;
  const grad = ctx.createLinearGradient(0, CY - GOLD_H, 0, CY - GOLD_H - glowH);
  grad.addColorStop(0,   `rgba(255, 200, 50, ${fi * 0.45})`);
  grad.addColorStop(0.4, `rgba(255, 160, 20, ${fi * 0.15})`);
  grad.addColorStop(1,   "rgba(255, 160, 20, 0)");

  ctx.fillStyle = grad;
  ctx.fillRect(0, CY - GOLD_H - glowH, CW, glowH);

  // Bright core strip right above the gold
  const coreH = 14 * fi;
  const coreGrad = ctx.createLinearGradient(0, CY - GOLD_H, 0, CY - GOLD_H - coreH);
  coreGrad.addColorStop(0, `rgba(255, 240, 100, ${fi * 0.7})`);
  coreGrad.addColorStop(1, "rgba(255, 240, 100, 0)");
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
  ctx.fillStyle = "rgba(70, 130, 200, 0.18)";
  ctx.fill();

  // Curved border
  ctx.beginPath();
  ctx.arc(CX, CY, R, 0, Math.PI);
  ctx.strokeStyle = "rgba(100, 170, 255, 0.35)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();
}

function drawGoldLayer(fi) {
  ctx.save();

  // Glow shadow on the gold rect itself
  ctx.shadowColor = `rgba(255, 210, 50, ${fi * 0.9})`;
  ctx.shadowBlur  = 18 + fi * 30;

  // Gold rectangle (sits on top of the flat face)
  const grad = ctx.createLinearGradient(0, CY - GOLD_H, 0, CY);
  grad.addColorStop(0, "#e6c000");
  grad.addColorStop(1, "#9a7800");
  ctx.fillStyle = grad;
  ctx.fillRect(CX - R, CY - GOLD_H, 2 * R, GOLD_H);

  ctx.shadowBlur = 0;

  // Thin bright top edge
  ctx.strokeStyle = `rgba(255, 230, 80, ${0.4 + fi * 0.5})`;
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
  ctx.strokeStyle = "rgba(150, 180, 220, 0.3)";
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
  const arcR  = 42;

  ctx.save();
  ctx.strokeStyle = "rgba(100, 200, 255, 0.55)";
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
  ctx.fillStyle = "rgba(100, 200, 255, 0.9)";
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
  const beamColor = grabbed ? "#ff8866" : "#ff4444";
  ctx.shadowColor = grabbed ? "rgba(255, 140, 80, 0.9)" : "rgba(255, 60, 60, 0.6)";
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
  ctx.strokeStyle = `rgba(255, 100, 100, ${reflAlpha})`;
  ctx.lineWidth   = 2;
  ctx.shadowColor = `rgba(255, 80, 80, ${reflAlpha * 0.5})`;
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

  // Top medium label
  ctx.fillStyle = "rgba(100, 180, 255, 0.55)";
  ctx.textAlign = "left";
  ctx.fillText("Top medium (n = " + _paramVal("top-n") + ")", 10, 18);

  // Gold label
  ctx.fillStyle = "rgba(220, 200, 50, 0.75)";
  ctx.textAlign = "left";
  ctx.fillText("Au  " + _paramVal("gold-nm") + " nm", 10, CY - GOLD_H - 5);

  // Glass label (inside half-disk)
  ctx.fillStyle = "rgba(100, 170, 255, 0.55)";
  ctx.textAlign = "center";
  ctx.fillText("Glass  n = " + _paramVal("prism-n"), CX, CY + R * 0.5);

  // λ label (bottom-right of diagram)
  ctx.fillStyle = "rgba(100, 170, 255, 0.4)";
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

  const wsURL = (API.startsWith("http")
    ? API.replace(/^http/, "ws")
    : `ws://${location.host}`) + "/ws/scan";

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

// Build lookup table, then draw initial state
(async () => {
  await buildLookupTable();
  setAngleUI(angle);
})();
