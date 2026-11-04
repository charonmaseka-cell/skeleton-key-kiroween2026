# Fonts (self-hosted)

Credits: **Pirata One** by Rodrigo Fuenzalida (SIL OFL 1.1) and **Special Elite** by Astigmatic (Apache License 2.0). Each font's licence file
is committed beside it in this folder.

Two files are served from this site (never from a font service). Both are used only with the effects on (Lights off, no reduced-motion
request): `effects.css`. Data text (tables, values, findings, counts) stays in the page's sans-serif.

| File | Font | Licence | Used for |
| --- | --- | --- | --- |
| `pirata-one-latin-400.woff2` | Pirata One, Latin (Fontsource build) | SIL Open Font License 1.1: `OFL-Pirata-One.txt` | the app title only |
| `special-elite-400-subset.woff2` | Special Elite Regular, subset | **Apache License 2.0**: `LICENSE-Apache-2.0-Special-Elite.txt` | the séance card and the themed stage names only |

## Pirata One (OFL 1.1)

Shipped **unmodified**. Its licence declares a Reserved Font Name, so a modified copy (for example a subset) could not keep the name; the
8.9 kB Latin file is used as it comes from `@fontsource/pirata-one`.

## Special Elite (Apache 2.0, not OFL)

Special Elite is by Astigmatic and is licensed under the Apache License 2.0 (the licence text is kept here). It is **not** under the OFL;
the Apache licence allows the use, subsetting and redistribution done here, on the conditions in the licence.

NOTICE: `special-elite-400-subset.woff2` is a **modified** copy of Special Elite Regular (38,268 bytes). It keeps all printable Basic Latin
(U+0020 to U+007E) plus é, the curly apostrophe ’ (U+2019), the curly quotes “ ” (U+201C, U+201D), the en and em dashes (U+2013, U+2014) and
the ellipsis … (U+2026), so supplier names with apostrophes never fall back to another font in the middle of a word. Anything else falls
back to the system monospace font. To reproduce it from the `@fontsource/special-elite` package (version 5, Latin, 400):

```
pyftsubset special-elite-latin-400-normal.woff2 --flavor=woff2 --layout-features=kern,liga \
  --unicodes="U+0020-007E,U+00E9,U+2019,U+201C,U+201D,U+2013,U+2014,U+2026" --output-file=special-elite-400-subset.woff2
```

Each app also holds a copy of both files in `public/fonts/` for its static 404 page (`public/404.html`), which has no script and no
stylesheet bundle.
