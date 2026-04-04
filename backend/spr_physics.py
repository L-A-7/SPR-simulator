"""
spr_physics.py — SPR calculation interface
==========================================
Replace calculate_spr() with your real TMM-based implementation.

Expected stack (Kretschmann):
  [prism]  /  [layer_1]  /  [layer_2]  / ... /  [top_medium]

The function receives:
  - angle_deg  : angle of incidence (degrees), measured from the normal to the
                 prism flat face (internal incidence angle in the prism)
  - lam_nm     : vacuum wavelength (nm)
  - layers     : list of dicts  { 'n': complex, 'd_nm': float }
                 ordered from prism side to top-medium side
                 (thicknesses; prism and top medium have no thickness)
  - n_prism    : complex refractive index of the prism
  - n_top      : complex refractive index of the top (ambient) medium

Returns a dict:
  {
    'angle':           float,   # echo of input angle (deg)
    'Rp':              float,   # p-polarisation power reflectance  [0, 1]
    'Rs':              float,   # s-polarisation power reflectance  [0, 1]
    'absorption':      float,   # 1 - Rp  (proxy: power absorbed by the stack)
    'field_intensity': float,   # evanescent near-field enhancement [0, 1] normalised
  }
"""

import numpy as np


# ---------------------------------------------------------------------------
#  PLACEHOLDER  —  replace the body of calculate_spr() with your TMM code
# ---------------------------------------------------------------------------

def calculate_spr(
    angle_deg: float,
    lam_nm: float = 632.8,
    n_prism: complex = 1.63 + 0j,          # e.g. H-BAK3 at 633 nm
    layers: list | None = None,             # [{'n': ..., 'd_nm': ...}, ...]
    n_top: complex = 1.333 + 0j,           # water
) -> dict:
    """
    Placeholder SPR calculation.

    Returns a Lorentzian dip in Rp centred just above the TIR angle,
    mimicking a typical gold-film SPR resonance.  Replace with your
    real T-matrix multilayer solver.
    """
    if layers is None:
        # Default: single 50 nm gold layer
        layers = [{"n": complex(0.18, 3.4), "d_nm": 50.0}]

    theta = np.radians(angle_deg)
    n_p = abs(n_prism)
    n_t = abs(n_top)

    # --- critical angle for TIR ---
    sin_c = n_t / n_p
    if sin_c >= 1.0:          # no TIR possible
        theta_c = np.pi / 2
    else:
        theta_c = np.arcsin(sin_c)

    # --- below TIR: simple Fresnel (no evanescent field) ---
    if theta <= theta_c:
        cos_i = np.cos(theta)
        sin_t_sq = (n_p * np.sin(theta) / n_t) ** 2
        if sin_t_sq > 1.0:
            Rp, Rs = 1.0, 1.0
        else:
            cos_t = np.sqrt(1.0 - sin_t_sq)
            rp = (n_t * cos_i - n_p * cos_t) / (n_t * cos_i + n_p * cos_t + 1e-30)
            rs = (n_p * cos_i - n_t * cos_t) / (n_p * cos_i + n_t * cos_t + 1e-30)
            Rp = float(abs(rp) ** 2)
            Rs = float(abs(rs) ** 2)
        return {
            "angle": angle_deg,
            "Rp": Rp,
            "Rs": Rs,
            "absorption": 1.0 - Rp,
            "field_intensity": 0.0,
        }

    # --- above TIR: SPR resonance (Lorentzian dip in Rp) ---
    # Approximate SPR angle: slightly above TIR, shifts with gold thickness and wavelength
    gold_nm = layers[0]["d_nm"] if layers else 50.0
    # Crude empirical shift for visualisation purposes
    delta_spr = np.radians(22.0 + (gold_nm - 50.0) * 0.05 + (lam_nm - 632.8) * 0.01)
    theta_spr = theta_c + delta_spr

    width = np.radians(1.8)           # angular half-width of the resonance
    dip_depth = 0.97                  # how deep the dip goes (0 = perfect coupler)

    lorentzian = 1.0 / (1.0 + ((theta - theta_spr) / width) ** 2)
    Rp = float(np.clip(1.0 - dip_depth * lorentzian, 0.0, 1.0))
    Rs = 1.0                          # s-pol is fully reflected above TIR

    absorption = 1.0 - Rp
    field_intensity = absorption      # peaks at resonance — good visual proxy

    return {
        "angle": angle_deg,
        "Rp": Rp,
        "Rs": Rs,
        "absorption": absorption,
        "field_intensity": field_intensity,
    }
