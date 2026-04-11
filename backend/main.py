"""
main.py — FastAPI backend for the SPR graphical simulator
=========================================================
Run:  uvicorn main:app --reload --port 8000
"""

import asyncio
import json
from pathlib import Path

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from spr_physics import calculate_spr

# ---------------------------------------------------------------------------
app = FastAPI(title="SPR Simulator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


# ---------------------------------------------------------------------------
#  REST — single angle
# ---------------------------------------------------------------------------

@app.get("/api/calculate")
def api_calculate(
    angle: float,
    lam_nm: float = 632.8,
    gold_nm: float = 50.0,
    top_n: float = 1.333,
    prism_n: float = 1.63,
) -> dict:
    """Return SPR observables for a single incidence angle."""
    layers = [{"n": complex(0.18, 3.4), "d_nm": gold_nm}]
    return calculate_spr(
        angle_deg=angle,
        lam_nm=lam_nm,
        n_prism=complex(prism_n),
        layers=layers,
        n_top=complex(top_n),
    )


@app.get("/api/lookup")
def api_lookup(
    angle_min: float = 0.0,
    angle_max: float = 89.5,
    n_steps: int = 250,
    lam_nm: float = 632.8,
    gold_nm: float = 50.0,
    top_n: float = 1.333,
    prism_n: float = 1.63,
) -> list:
    """Return a dense angle scan as a JSON array for client-side interpolation."""
    layers = [{"n": complex(0.18, 3.4), "d_nm": gold_nm}]
    angles = np.linspace(angle_min, angle_max, n_steps)
    return [
        calculate_spr(
            angle_deg=float(a),
            lam_nm=lam_nm,
            n_prism=complex(prism_n),
            layers=layers,
            n_top=complex(top_n),
        )
        for a in angles
    ]


# ---------------------------------------------------------------------------
#  WebSocket — angular scan (streams one point per message)
# ---------------------------------------------------------------------------

@app.websocket("/ws/scan")
async def ws_scan(websocket: WebSocket) -> None:
    """
    Protocol
    --------
    Client → server  (once, JSON):
        { angle_min, angle_max, n_steps, lam_nm, gold_nm, top_n, prism_n,
          duration_s }
        duration_s  : desired total animation time (seconds, default 4)

    Server → client  (repeated, JSON):
        { angle, Rp, Rs, absorption, field_intensity }

    Server → client  (final, JSON):
        { done: true }

    Client → server  (any time):
        "stop"   → server stops streaming
    """
    await websocket.accept()
    stop_flag = False

    async def _listen_for_stop() -> None:
        nonlocal stop_flag
        try:
            while True:
                msg = await websocket.receive_text()
                if msg.strip().lower() == "stop":
                    stop_flag = True
                    return
        except Exception:
            stop_flag = True

    try:
        # Receive parameters first — listener starts after, avoiding concurrent recv
        raw = await websocket.receive_text()
        params = json.loads(raw)
        listener = asyncio.create_task(_listen_for_stop())

        angle_min  = float(params.get("angle_min",  35.0))
        angle_max  = float(params.get("angle_max",  80.0))
        n_steps    = int(params.get("n_steps",      150))
        lam_nm     = float(params.get("lam_nm",     632.8))
        gold_nm    = float(params.get("gold_nm",    50.0))
        top_n      = float(params.get("top_n",      1.333))
        prism_n    = float(params.get("prism_n",    1.63))
        duration_s = float(params.get("duration_s", 4.0))

        layers = [{"n": complex(0.18, 3.4), "d_nm": gold_nm}]

        # Pre-compute all values (fast, CPU-bound)
        angles = np.linspace(angle_min, angle_max, n_steps)
        results = [
            calculate_spr(
                angle_deg=float(a),
                lam_nm=lam_nm,
                n_prism=complex(prism_n),
                layers=layers,
                n_top=complex(top_n),
            )
            for a in angles
        ]

        delay = duration_s / n_steps

        for result in results:
            if stop_flag:
                break
            await websocket.send_text(json.dumps(result))
            await asyncio.sleep(delay)

        if not stop_flag:
            await websocket.send_text(json.dumps({"done": True}))

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try:
            await websocket.send_text(json.dumps({"error": str(exc)}))
        except Exception:
            pass
    finally:
        if "listener" in dir():
            listener.cancel()


# ---------------------------------------------------------------------------
#  Static files — serve the frontend (must be last)
# ---------------------------------------------------------------------------

app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
