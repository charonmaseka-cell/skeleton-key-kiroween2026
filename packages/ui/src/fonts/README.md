# Display font (self-hosted)

`cormorant-garamond-700-subset.woff2` is **Cormorant Garamond Bold**, Latin, by the Cormorant Project Authors, licensed under the
SIL Open Font License 1.1 (`OFL.txt` here; the licence declares no Reserved Font Name). It is served from this site, not from a font
service, and is used only for the app title and the séance heading, and only when the effects are on (Lights off, no reduced-motion
request): `effects.css`.

It is a subset (8.7 kB instead of 22 kB): Basic Latin letters, digits, common punctuation and the letter é, which covers "ScopeCheck",
"PackCheck" and "The séance". Reproduce it from the `@fontsource/cormorant-garamond` package (version 5):

```
pyftsubset cormorant-garamond-latin-700-normal.woff2 --flavor=woff2 --layout-features=kern,liga \
  --text="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:;'-—()éÉ" --output-file=cormorant-garamond-700-subset.woff2
```

A character outside that set falls back to Georgia or the system serif, so a heading never breaks.
