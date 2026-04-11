# SPR Physics Reference

## Surface Plasmon Resonance — overview

Surface Plasmon Resonance occurs when p-polarised (TM) light couples to a propagating charge-density wave (surface plasmon polariton) at a metal/dielectric interface. At the resonance angle θ_SPR, the in-plane component of the photon wave vector matches the surface plasmon wave vector, leading to a sharp drop in reflectance Rp and a corresponding peak in the evanescent field at the interface.

The **Kretschmann configuration** uses a thin metal film deposited on the flat face of a glass prism. The beam enters through the curved face, undergoes total internal reflection at the prism/metal interface, and the evanescent tail penetrates the metal into the analyte.

```
          laser (p-pol)
              ↓
    ╔══════════════════╗   prism (glass, n_p ≈ 1.63)
    ║                  ║
    ╚══════════════════╝
    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   gold film (~50 nm)
    ░░░░░░░░░░░░░░░░░░░░   analyte (water, n_a ≈ 1.333)
```

---

## Transfer Matrix Method (TMM)

The implementation in `backend/spr_physics.py` follows the standard TMM for a multilayer planar stack.

### Stack convention

Layers are indexed from 0 (input medium / prism) to N−1 (output medium / analyte). The first and last layers are semi-infinite (thickness `h = 0`).

```
layer 0:   prism         n_0,  h_0 = 0       (semi-infinite)
layer 1:   gold          n_1,  h_1 = 50 nm
  ...
layer N-1: top medium    n_{N-1}, h_{N-1} = 0  (semi-infinite)
```

### Wave vectors

For a beam incident at angle θ in layer 0, the in-plane wave vector component σ is conserved across all interfaces (Snell's law in wave-vector form):

```
σ = (2π n_0 / λ) · sin(θ)
```

The z-component in layer i:

```
β_i = sqrt( (2π n_i / λ)² − σ² )
```

For a lossy metal, n_i is complex, so β_i is complex (evanescent field).

### Interface transfer matrix

At the interface between layers i and i+1, the amplitude transfer for TE (s) and TM (p) polarisations:

```
s = 0.5 · (1 + (p_{i+1} β_{i+1}) / (p_i β_i))
d = 0.5 · (1 − (p_{i+1} β_{i+1}) / (p_i β_i))

where:
  p_i = 1           for TE
  p_i = 1 / n_i²    for TM
```

The propagation through layer i of thickness h:

```
C = diag( exp(−iβ_i h),  exp(+iβ_i h) )
```

### Boundary conditions

Starting from the last layer with only a transmitted wave (no backward component):

```
Am[N-1] = 1,  Ap[N-1] = 0
```

The backward recursion fills Am[i], Ap[i] from i = N−2 down to 0.

Reflection coefficients:

```
r_TE = Ap[0,TE] / Am[0,TE]
r_TM = Ap[0,TM] / Am[0,TM]

R_TE = |r_TE|²
R_TM = |r_TM|²
```

---

## Outputs

| Symbol | Meaning | Range |
|---|---|---|
| `Rp` | TM (p-pol) power reflectance | [0, 1] |
| `Rs` | TE (s-pol) power reflectance | [0, 1] |
| `absorption` | `1 − Rp` | [0, 1] |
| `field_intensity` | proxy for near-field enhancement (= absorption) | [0, 1] |

> **Note:** `field_intensity` is currently the absorption, not a true electromagnetic near-field enhancement. A rigorous near-field calculation would require extracting the field amplitude at the gold/analyte interface from the transfer matrix coefficients.

---

## Default stack parameters

| Layer | Parameter | Default value |
|---|---|---|
| Prism | n_prism | 1.63 + 0j (LaSF glass) |
| Gold | n_gold | 0.18 + 3.4j (at 633 nm) |
| Gold | d_gold | 50 nm |
| Analyte | n_top | 1.333 + 0j (water) |
| Laser | λ | 632.8 nm (He-Ne) |

---

## Resonance angle — quick estimate

The SPR angle can be estimated from the momentum matching condition:

```
θ_SPR ≈ arcsin( sqrt( ε_m · ε_d / (ε_m + ε_d) ) / n_prism )
```

where ε_m = n_gold² and ε_d = n_top² are the metal and dielectric permittivities.

For the defaults above: θ_SPR ≈ 68–70°.

---

## Sensitivity to analyte refractive index

SPR sensors exploit the shift of θ_SPR with n_top. A typical bulk sensitivity is:

```
Δθ_SPR / Δn_top ≈ 50–100 °/RIU
```

(RIU = refractive index unit). To simulate this, sweep `top_n` in the UI while noting the dip position.

---

## Extending the stack

Pass a custom `layers` list to `calculate_spr()`:

```python
from spr_physics import calculate_spr

result = calculate_spr(
    angle_deg=65.0,
    lam_nm=785.0,           # NIR laser
    n_prism=1.845 + 0j,     # SF11 glass
    layers=[
        {"n": complex(0.18, 4.8), "d_nm": 48.0},   # Au at 785 nm
        {"n": 1.45 + 0j,          "d_nm": 5.0},    # SiO2 linker
    ],
    n_top=1.333 + 0j,
)
```

Layers are ordered from prism side to analyte side.
