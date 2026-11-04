# Art provenance (candlelight pass, HU-33)

All art is original and drawn in code in `packages/ui/src/Art.tsx` (SVG paths written for this project) and `packages/ui/src/Runes.tsx`
(24 rune strokes). No stock photo, no third-party image and no raster file is in the repository (a test checks this). Colour is in
`packages/ui/src/effects.css` as `.art-*` classes; warm colours (amber, orange) are used only there, in the header, gutters and illustrations,
never on or near a status badge.

| Piece | Where | Notes |
| --- | --- | --- |
| `PumpkinG` (grin, oh) | header, séance card, corner button, 404 | carved from ellipses and polygons |
| `LanternG` | header, séance card, 404 | iron cage, glass, candle |
| `CandlesG` | séance card | three candles |
| `LockAndKeyG` | header | the spectral key turns once per set (0.8 s) |
| `SeanceArt` | beside the séance counts (768 px and up) | table, pumpkin, candles, lantern, planchette, wisps |
| `Runes` | title and séance heading for 3 s after a trick | arithmetic choice, never random |

Fonts: see `packages/ui/src/fonts/README.md` (Pirata One, OFL 1.1; Special Elite, Apache 2.0). The app plays no sound.
