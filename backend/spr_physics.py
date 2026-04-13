"""
spr_physics.py — SPR calculation via Transfer Matrix Method
============================================================
Multilayer function adapted from SimulatedSignal.multilayer()
in ipsoLAB/ipso/signals/simulated_signals.py.

Stack convention (Kretschmann):
  [prism]  /  [layer_1]  /  ...  /  [top_medium]

Returns a dict:
  {
    'angle':           float,   # echo of input angle (deg)
    'Rp':              float,   # p-polarisation (TM) power reflectance  [0, 1]
    'Rs':              float,   # s-polarisation (TE) power reflectance  [0, 1]
    'absorption':      float,   # 1 - Rp
    'field_intensity': float,   # proportional to absorption (proxy)
    'delta_s':         float,   # phase of s-pol reflection coefficient (deg, −180…180)
    'delta_p':         float,   # phase of p-pol reflection coefficient (deg, −180…180)
  }
"""

import numpy as np


# ---------------------------------------------------------------------------
#  Transfer matrix method
# ---------------------------------------------------------------------------

def multilayer(nu: np.ndarray, h: list, wav: float, theta: float) -> list:
    """Reflection/transmission from a multilayer stack.

    Parameters
    ----------
    nu    : complex refractive indices of each layer (length N)
    h     : thickness of each layer in the same unit as wav (length N);
            use 0 for semi-infinite media (first and last layers)
    wav   : wavelength (same unit as h)
    theta : angle of incidence in the first medium (degrees)

    Returns
    -------
    [R_TE, R_TM, T_TE, T_TM, delta_r, delta_t]
      TE = s-polarisation, TM = p-polarisation
      delta_r / delta_t : phase difference TE−TM for reflection/transmission (degrees)
    """
    TE = 0
    TM = 1

    def transfer(Ap2, Am2, sigma, n1, n2, h, pola, wav):
        k1 = 2 * np.pi * n1 / wav
        k2 = 2 * np.pi * n2 / wav
        beta1 = np.sqrt(k1**2 - sigma**2)
        beta2 = np.sqrt(k2**2 - sigma**2)
        p1 = 1 if pola == TE else 1 / n1**2
        p2 = 1 if pola == TE else 1 / n2**2
        s = 0.5 * (1 + (p2 * beta2) / (p1 * beta1))
        d = 0.5 * (1 - (p2 * beta2) / (p1 * beta1))
        T = np.array([[s, d], [d, s]])
        C = np.array([[np.exp(-1j * beta1 * h), 0], [0, np.exp(1j * beta1 * h)]])
        M = C @ T
        V = M @ [Am2, Ap2]
        return [V[1], V[0]]   # [Ap1, Am1]

    Nc = len(h)
    Am = np.zeros((Nc, 2), dtype=np.cdouble)
    Ap = np.zeros((Nc, 2), dtype=np.cdouble)
    Am[-1, :] = 1 + 0j   # only transmitted light in the last layer
    Ap[-1, :] = 0 + 0j

    k0 = 2 * np.pi * nu[0] / wav
    sigma = k0 * np.sin(np.radians(theta))

    for pola in [TE, TM]:
        for n in range(Nc - 2, -1, -1):
            Ap[n, pola], Am[n, pola] = transfer(
                Ap[n + 1, pola], Am[n + 1, pola],
                sigma, nu[n], nu[n + 1], h[n], pola, wav,
            )

    r_TE = Ap[0, TE] / Am[0, TE]
    r_TM = Ap[0, TM] / Am[0, TM]
    t_TE = Am[-1, TE] / Am[0, TE]
    t_TM = Am[-1, TM] / Am[0, TM]

    R_TE = float(np.abs(r_TE) ** 2)
    R_TM = float(np.abs(r_TM) ** 2)
    T_TE = 0.0   # transmission not implemented
    T_TM = 0.0
    delta_r = float(np.angle(r_TE * np.conj(r_TM)) * 180 / np.pi)
    delta_t = float(np.angle(t_TE * np.conj(t_TM)) * 180 / np.pi)
    delta_s = float(np.angle(r_TE) * 180 / np.pi)   # phase of s-pol reflection (deg)
    delta_p = float(np.angle(r_TM) * 180 / np.pi)   # phase of p-pol reflection (deg)

    return [R_TE, R_TM, T_TE, T_TM, delta_r, delta_t, delta_s, delta_p]


# ---------------------------------------------------------------------------
#  Public API — called by main.py
# ---------------------------------------------------------------------------

def calculate_spr(
    angle_deg: float,
    lam_nm: float = 632.8,
    n_prism: complex = 1.5 + 0j,
    layers: list | None = None,
    n_top: complex = 1.33 + 0j,
) -> dict:
    """Compute SPR observables for a single angle using the TMM."""
    if layers is None:
        layers = [{"n": complex(0.18, 3.4), "d_nm": 50.0}]

    # Build index and thickness arrays: [prism, *layers, top]
    nu = np.array(
        [n_prism] + [lay["n"] for lay in layers] + [n_top],
        dtype=np.cdouble,
    )
    h = [0.0] + [lay["d_nm"] for lay in layers] + [0.0]

    Rs, Rp, _T_TE, _T_TM, _delta_r, _delta_t, delta_s, delta_p = multilayer(
        nu, h, lam_nm, angle_deg
    )

    absorption      = float(np.clip(1.0 - Rp, 0.0, 1.0))
    field_intensity = absorption

    return {
        "angle":           angle_deg,
        "Rp":              float(np.clip(Rp, 0.0, 1.0)),
        "Rs":              float(np.clip(Rs, 0.0, 1.0)),
        "absorption":      absorption,
        "field_intensity": field_intensity,
        "delta_s":         delta_s,
        "delta_p":         delta_p,
    }
