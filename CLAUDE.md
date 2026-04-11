# CLAUDE.md — AI assistant guide for SPR Simulator

## Project in one sentence

A vanilla-JS + FastAPI SPR simulator: the browser fetches TMM physics results from a Python backend and renders them on an HTML5 Canvas optical diagram with Plotly scan curves.

---

## Architecture

```
frontend/          Vanilla JS (no bundler, no framework)
  index.html       Entry point; loads Plotly from CDN, then app.js
  app.js           All UI logic in one file (~640 lines)
  tokens.css       Design tokens (colours, spacing)
  base.css         Reset + typography
  style.css        Component layout

backend/
  main.py          FastAPI app — REST + WebSocket endpoints
  spr_physics.py   TMM physics — multilayer() + calculate_spr()
  requirements.txt fastapi, uvicorn[standard], numpy

spr-simulator.service   systemd unit (uvicorn on 127.0.0.1:8004)
spr.la-7.eu.nginx       nginx reverse proxy + SSL + WS upgrade
```

**No build step.** The backend serves `frontend/` as static files. There is no React, no Vite, no npm, no TypeScript.

---

## Key design decisions

- **Single JS file** (`app.js`): all state, rendering, and API calls live here. Do not split into modules without a good reason — there is no bundler to reassemble them.
- **Canvas-only diagram**: the optical diagram is drawn entirely with the HTML5 Canvas 2D API. There is no SVG in the current implementation (CONTEXT.md describes an earlier SVG design that was replaced).
- **WebSocket scan** (not SSE): the `/ws/scan` endpoint replaced a previous SSE endpoint. The client sends parameters once; the server streams one JSON object per angle step.
- **Lookup table for live interaction**: `/api/lookup` pre-fetches a dense scan on page load / parameter change. The live drag uses client-side interpolation from this table — not a per-drag HTTP request.
- **Plotly from CDN**: loaded via `<script>` tag in `index.html`. Do not replace with a bundled import.

---

## Physics model

- Configuration: **Kretschmann** (prism / gold / analyte)
- Method: **Transfer Matrix Method** (TMM), p- and s-polarisation
- Default stack: LaSF prism (n=1.63) / 50 nm Au (n=0.18+3.4i) / water (n=1.333)
- Wavelength: 632.8 nm (He-Ne laser) by default
- `field_intensity` is currently proxied as `1 - Rp` (absorption). It is not a true near-field enhancement.

See `docs/physics.md` for full detail.

---

## API surface

| Endpoint | Purpose |
|---|---|
| `GET /api/calculate` | Single-angle TMM result |
| `GET /api/lookup` | Dense angle scan, returns JSON array |
| `WS  /ws/scan` | Animated scan streamed over WebSocket |

Full schemas in `docs/api.md`.

---

## What NOT to change without understanding the consequences

- **`multilayer()` in `spr_physics.py`**: the indexing convention (`Am[-1] = 1`, backward propagation) is non-obvious but correct. Changing loop direction or sign conventions will silently break the physics.
- **WebSocket stop protocol**: the client sends the string `"stop"` at any time. The server has a concurrent `_listen_for_stop` task. Do not switch to a request/response model.
- **`wss://` vs `ws://`**: `app.js` detects `location.protocol` to pick the right WS scheme. Do not hardcode `ws://`.
- **nginx WebSocket headers**: `Upgrade` and `Connection: upgrade` headers in `spr.la-7.eu.nginx` are required for `/ws/scan` to work through the proxy. Do not remove them.

---

## Local dev workflow

```bash
source .venv/bin/activate
cd backend
uvicorn main:app --reload --port 8000
# open http://localhost:8000
```

No frontend dev server needed — uvicorn serves `frontend/` directly.

---

## Adding a new physical parameter

1. Add the query param to `api_calculate`, `api_lookup`, and `ws_scan` in `main.py` (with a sensible default).
2. Pass it through to `calculate_spr()` in `spr_physics.py`.
3. Add an `<input>` in `index.html` and read it in the `params()` helper in `app.js`.
4. Trigger a lookup-table refresh on change (call `fetchLookup()` from the input's `change` event, mirroring how `lam-nm` etc. are wired up).
