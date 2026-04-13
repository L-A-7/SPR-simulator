# SPR Simulator — UI Layout

## Desktop (> 700 px)

Two-column flex row (`#content-row`): left panel fixed at 188 px, main column fills remaining width.

```
+------------------+------------------------------------------+
|                  | obs-bar: SPR Simulator | θ  λ  Rp  Rs … |
|   Parameters     +------------------------------------------+
|                  |                                          |
+------------------+             main-anim-box               |
|                  |            (canvas diagram)              |
|     Angle        |                                          |
|                  |                                          |
+------------------+------------------------------------------+
|                  |                                          |
|   Angle Scan     |             Curves 1                     |
|                  |           (scan results)                 |
+------------------+------------------------------------------+
|                  |                                          |
| Curves Display   |             Curves 2                     |
|  (placeholder)   |           (placeholder)                  |
+------------------+                                          |
|                  |                                          |
|     Export       |                                          |
|  (placeholder)   |                                          |
+------------------+------------------------------------------+
```

### Structure

```
#app  (flex column)
└── #content-row  (flex row, align-items: flex-start)
    ├── #left-panel  (flex column, 188 px fixed)
    │   ├── #params-box          — physics parameters
    │   ├── #angle-scan-wrap     — transparent on desktop (display: contents)
    │   │   ├── #angle-box       — angle slider & manual entry
    │   │   └── #scan-box        — angle scan controls
    │   ├── #curves-display-box  — (placeholder)
    │   └── #export-box          — (placeholder)
    └── #main-col  (flex column, flex: 1)
        ├── #main-anim-box   — obs-bar (title + live values + theme toggle)
        │                      + canvas optical diagram
        ├── #charts-panel    — Curves 1, scan result plots
        └── #curves-2-panel  — Curves 2 (placeholder)
```

---

## Phone (≤ 700 px)

Content column stacks main-col first, then the left-panel controls in a 2-column grid.
`#angle-scan-wrap` becomes a single fused panel spanning both columns.

```
+-------------------------------------+
| obs-bar: SPR Simulator | θ  λ  Rp … |
+-------------------------------------+
|                                     |
|           main-anim-box             |
|          (canvas diagram)           |
|                                     |
+-------------------------------------+
| Angle Scan                          |
| 65.0°  [slider ——————————————————]  |
| From[_] To[_] Steps[___] [▶ Scan]  |
+------------------+------------------+
|                                     |
|              Curves 1               |
|           (scan results)            |
|                                     |
+-------------------------------------+
|                                     |
|              Curves 2               |
|            (placeholder)            |
|                                     |
+------------------+------------------+
| Curves Display   |     Export       |
|  (placeholder)   |  (placeholder)   |
+------------------+------------------+
|                                     |
|            Parameters               |
|                                     |
+-------------------------------------+
```
