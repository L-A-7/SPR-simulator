# SPR Simulator

Interactive web-based **Surface Plasmon Resonance (SPR)** simulator using the Kretschmann configuration. Drag the laser beam, tune physical parameters, and run angle scans to observe the SPR dip in real time.

![Light and dark themes, canvas optical diagram, Plotly scan curves]

---

## What it does

- Renders an optical diagram: half-cylinder prism, gold thin film, incident/reflected laser beam
- Computes Rp, Rs, absorption, and field enhancement via the Transfer Matrix Method (TMM)
- Animates the evanescent-field glow at the gold layer, intensity-mapped to absorption
- Streams an animated angle scan over WebSocket and plots results with Plotly

---

## Quick start — development

```bash
# 1. Create and activate a Python virtual environment
python3 -m venv .venv
source .venv/bin/activate

# 2. Install backend dependencies
pip install -r backend/requirements.txt

# 3. Start the backend (serves API + static frontend)
cd backend
uvicorn main:app --reload --port 8000
```

Open `http://localhost:8000` in your browser. The backend serves the `frontend/` directory directly — no build step needed.

---

## UI guide

### Parameters panel (left)

| Field | Default | Description |
|---|---|---|
| λ (nm) | 632.8 | Laser wavelength (He-Ne) |
| Gold thickness (nm) | 50 | Thickness of the gold film |
| Prism n | 1.63 | Refractive index of the glass prism |
| Top medium n | 1.333 | Refractive index of the analyte medium (water ≈ 1.333) |

### Angle control

- **Drag the laser beam** on the canvas to change the incidence angle interactively
- Use the **slider** or **manual entry** for precise values
- The observables bar updates live: θ, λ, Rp, Rs, Absorption, Field enhancement

### Angle scan

Set the angular range and number of steps, then click **Run Scan**.  
The beam animates across the range while Plotly plots Rp, Rs, and Absorption vs angle in real time.  
Click **Stop** to interrupt at any point.

---

## Production deployment

The repository includes ready-to-use configuration files.

### 1. Copy the systemd service

```bash
sudo cp spr-simulator.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now spr-simulator
```

The service runs uvicorn on `127.0.0.1:8004` as user `l`.  
Edit `WorkingDirectory`, `ExecStart`, and `User` if your paths differ.

### 2. Copy the nginx config

```bash
sudo cp spr.la-7.eu.nginx /etc/nginx/sites-available/spr.la-7.eu
sudo ln -s /etc/nginx/sites-available/spr.la-7.eu /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Obtain a TLS certificate before enabling the HTTPS server block:

```bash
sudo certbot --nginx -d spr.la-7.eu
```

### Topology

```
Browser (HTTPS/WSS)
  └── nginx :443
        └── proxy_pass → uvicorn 127.0.0.1:8004
              ├── GET  /api/calculate  →  single-angle TMM result
              ├── GET  /api/lookup     →  dense scan as JSON array
              ├── WS   /ws/scan        →  streamed animated scan
              └── GET  /*              →  frontend/index.html + static assets
```

---

## Customising the physics

The physics are in `backend/spr_physics.py`. To use a different metal or add layers, pass a custom `layers` list to `calculate_spr`:

```python
layers = [
    {"n": complex(0.18, 3.4), "d_nm": 50.0},   # gold
    {"n": 1.45 + 0j,          "d_nm": 10.0},   # SiO2 adhesion layer
]
result = calculate_spr(angle_deg=65.0, layers=layers)
```

Each layer dict requires `n` (complex refractive index) and `d_nm` (thickness in nm).  
The first and last stack entries (prism and top medium) are always semi-infinite (`d = 0`).
