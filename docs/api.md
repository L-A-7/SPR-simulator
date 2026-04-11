# API Reference

Base URL in production: `https://spr.la-7.eu`  
Base URL in development: `http://localhost:8000`

---

## GET /api/calculate

Compute SPR observables for a single incidence angle.

### Query parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `angle` | float | **required** | Incidence angle in degrees |
| `lam_nm` | float | 632.8 | Laser wavelength (nm) |
| `gold_nm` | float | 50.0 | Gold film thickness (nm) |
| `top_n` | float | 1.333 | Refractive index of the top (analyte) medium |
| `prism_n` | float | 1.63 | Refractive index of the prism |

### Response

```json
{
  "angle":           65.0,
  "Rp":              0.042,
  "Rs":              0.981,
  "absorption":      0.958,
  "field_intensity": 0.958
}
```

| Field | Description |
|---|---|
| `angle` | Echo of the input angle |
| `Rp` | TM (p-polarisation) power reflectance [0, 1] |
| `Rs` | TE (s-polarisation) power reflectance [0, 1] |
| `absorption` | `1 − Rp` |
| `field_intensity` | Proxy for evanescent field enhancement (= absorption) |

### Example

```bash
curl "https://spr.la-7.eu/api/calculate?angle=65&top_n=1.4"
```

---

## GET /api/lookup

Return a dense pre-computed angle scan as a JSON array. Used by the frontend for client-side interpolation during live beam dragging.

### Query parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `angle_min` | float | 0.0 | Start of the scan range (degrees) |
| `angle_max` | float | 89.5 | End of the scan range (degrees) |
| `n_steps` | int | 250 | Number of points |
| `lam_nm` | float | 632.8 | Laser wavelength (nm) |
| `gold_nm` | float | 50.0 | Gold film thickness (nm) |
| `top_n` | float | 1.333 | Top medium refractive index |
| `prism_n` | float | 1.63 | Prism refractive index |

### Response

A JSON array of objects, each identical to a `/api/calculate` response:

```json
[
  { "angle": 0.0,  "Rp": 0.998, "Rs": 0.998, "absorption": 0.002, "field_intensity": 0.002 },
  { "angle": 0.36, "Rp": 0.997, ... },
  ...
  { "angle": 89.5, "Rp": 0.991, ... }
]
```

### Example

```bash
curl "https://spr.la-7.eu/api/lookup?n_steps=500&top_n=1.35"
```

---

## WS /ws/scan

WebSocket endpoint for animated angle scans. The server streams one data point per message at a rate that fills the requested `duration_s`.

### Connection

```
wss://spr.la-7.eu/ws/scan
```

### Protocol

**Step 1 — client sends parameters (once, as JSON text):**

```json
{
  "angle_min":  35.0,
  "angle_max":  80.0,
  "n_steps":    150,
  "lam_nm":     632.8,
  "gold_nm":    50.0,
  "top_n":      1.333,
  "prism_n":    1.63,
  "duration_s": 4.0
}
```

All fields are optional; defaults shown above.

**Step 2 — server streams data points (one JSON message per angle):**

```json
{ "angle": 35.0,  "Rp": 0.992, "Rs": 0.998, "absorption": 0.008, "field_intensity": 0.008 }
{ "angle": 35.3,  ... }
...
```

**Step 3 — server sends completion sentinel:**

```json
{ "done": true }
```

**Stopping early — client sends at any time:**

```
stop
```

(Plain text string, not JSON.) The server stops streaming and closes cleanly.

**Error — server sends and closes:**

```json
{ "error": "description" }
```

### Timing

The server pre-computes all `n_steps` TMM values, then streams them with a delay of `duration_s / n_steps` between messages. For 150 steps over 4 s, that is ~27 ms per message.

### Example (Python client)

```python
import asyncio, json
import websockets

async def scan():
    async with websockets.connect("wss://spr.la-7.eu/ws/scan") as ws:
        await ws.send(json.dumps({
            "angle_min": 40, "angle_max": 80, "n_steps": 100, "duration_s": 2
        }))
        async for msg in ws:
            data = json.loads(msg)
            if data.get("done"):
                break
            print(f"θ={data['angle']:.1f}°  Rp={data['Rp']:.4f}")

asyncio.run(scan())
```

---

## Notes

- The gold refractive index is hard-coded to `n = 0.18 + 3.4j` (Au at 632.8 nm). It does not scale with `lam_nm`. For other wavelengths, edit `spr_physics.py` or extend the API with a `gold_n_re` / `gold_n_im` parameter pair.
- CORS is open (`allow_origins=["*"]`) for development convenience. Restrict it in production if the API should not be callable from arbitrary origins.
