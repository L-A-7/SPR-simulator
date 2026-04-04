# SPR Graphical Simulator — Project Context

## Project Goal
Build an interactive web-based **Surface Plasmon Resonance (SPR) simulator** with:
- A Python/FastAPI backend that performs the SPR physics calculations
- A React frontend with SVG optical diagram, Canvas glow effect, and Recharts scan curves

---

## Physical Setup (as displayed in the UI)
- A laser beam enters a **half-cylinder of glass** (viewed from the side = a half-disk)
  from the **rounded/curved side**
- On the **flat top** of the half-disk sits a **thin gold layer**
  (real thickness ~50 nm, but rendered a few mm thick for visibility)
- The laser beam angle is adjustable in **[0°, 90°[**
- At the **SPR resonance angle**, a glowing effect appears around the gold layer,
  representing the enhanced local electromagnetic field

---

## User Interactions
- **Drag the laser beam** with the mouse to change the angle (SVG + mouse events)
- **Angle input / slider** as fallback for precise control
- **Scan button**: auto-sweeps angles over a few seconds, animates the beam,
  and plots resulting curves below the diagram

---

## Backend — FastAPI

### Endpoints to implement
```
GET  /calculate?angle={float}
     → Returns: { transmission, absorption, field_intensity } for a single angle

POST /scan?angle_min={float}&angle_max={float}&steps={int}
     → Streams scan results via Server-Sent Events (SSE)
     → Each event: { angle, transmission, absorption, field_intensity }
```

### Python SPR physics
- The user will provide their own SPR calculation code (e.g. `spr_calc.py`)
- It should expose a function like:
  `calculate_spr(angle_deg: float) -> dict` returning transmission, absorption, field_intensity
- Use **numpy** for angle arrays in scan mode
- Use **FastAPI + uvicorn** as the ASGI server
- Use **fastapi.responses.StreamingResponse** for SSE scan endpoint
- Add **CORS middleware** to allow the React dev server (localhost:5173) during development

### File structure
```
backend/
  main.py          # FastAPI app, routes
  spr_calc.py      # Physics calculation (user-provided or placeholder)
  requirements.txt # fastapi, uvicorn, numpy, (scipy if needed)
```

---

## Frontend — React (Vite)

### Tech stack
- **React** (Vite scaffold) for UI and state management
- **SVG** for the optical diagram (half-disk, gold layer, laser beam, refracted/reflected rays)
- **HTML5 Canvas** (overlaid on SVG) for the glow/field intensity effect
- **Recharts** for the scan result curves
- **Tailwind CSS** or plain CSS modules for layout

### Component tree
```
App
├── DiagramPanel
│   ├── OpticalDiagram (SVG)
│   │   ├── HalfDisk (glass prism)
│   │   ├── GoldLayer (thin rectangle on flat side)
│   │   ├── LaserBeam (draggable line, incident + reflected)
│   │   └── EvanescentField (Canvas overlay, glow effect)
│   └── AngleControl (slider or numeric input)
├── ScanControls
│   └── ScanButton + progress indicator
└── ResultsPanel
    └── ScanChart (Recharts: transmission, absorption, field_intensity vs angle)
```

### Key implementation details

#### Laser beam drag
- Track `mousemove` on the SVG element
- Compute angle: `Math.atan2(dy, dx)` from center of the half-disk flat face
- Clamp to [0°, 90°[
- Debounce the fetch to `/calculate?angle=X` (~50ms)

#### Glow effect (Canvas)
- Overlay a `<canvas>` element on top of the SVG, same dimensions
- On each angle update, redraw:
  ```js
  ctx.clearRect(...)
  ctx.shadowBlur = field_intensity * SCALE_FACTOR  // e.g. 0–100
  ctx.shadowColor = `rgba(255, 200, 50, ${alpha})`
  ctx.fillRect(goldLayerRect)  // draw gold layer with glow
  ```
- `field_intensity` comes from the backend response

#### Scan animation
- Call `/scan` SSE endpoint
- On each SSE event: update beam angle in SVG + append data point to chart
- Full sweep should take ~3–5 seconds visually (throttle or use SSE timing)

### File structure
```
frontend/
  src/
    App.jsx
    components/
      DiagramPanel.jsx
      OpticalDiagram.jsx   # SVG diagram
      EvanescentField.jsx  # Canvas glow overlay
      AngleControl.jsx
      ScanControls.jsx
      ScanChart.jsx        # Recharts wrapper
    hooks/
      useSPRCalculation.js # fetch /calculate on angle change
      useScan.js           # SSE scan stream handler
    api.js                 # API base URL config
  index.html
  vite.config.js
  package.json
```

---

## Deployment (VPS)

```
Nginx
  ├── /api/*  →  FastAPI on uvicorn (port 8000, internal)
  └── /*      →  React build (dist/) served as static files
```

- FastAPI can also serve the React `dist/` folder via `StaticFiles` for a single-process deployment
- Use `systemd` or `supervisor` to keep uvicorn running
- SSL via Let's Encrypt / certbot

---

## Development startup

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev   # runs on localhost:5173, proxies /api to :8000
```

Add to `vite.config.js`:
```js
server: {
  proxy: {
    '/api': 'http://localhost:8000'
  }
}
```

---

## Starting point for Claude Code

1. Scaffold `backend/main.py` with FastAPI, CORS, `/calculate` and `/scan` (SSE) endpoints,
   and a **placeholder** `spr_calc.py` that returns mock data
2. Scaffold the React/Vite frontend with the component tree above
3. Implement the SVG optical diagram with draggable beam angle
4. Implement the Canvas glow overlay tied to `field_intensity`
5. Implement the Recharts scan curves panel
6. Wire up the SSE scan stream to the animated sweep

The user will replace `spr_calc.py` with their real SPR physics code.