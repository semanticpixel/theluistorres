# Legacy site — archived

The static `index.html` build that lived at the root of this repo before the
Astro migration. Kept for archival reference; nothing here is referenced by
the current production build under `dist/`.

- `index.html` — the previous single-page site
- `dist/` — pre-build artifacts the old gulp pipeline emitted
- `gulpfile.js`, `app.js`, `src/`, `scripts/` — original build inputs
- `CNAME` — the previous `theluistorres.com` mapping (production now uses
  `projectluis.com`, configured via `public/CNAME` at the repo root)

If you need to bring something forward, copy the file into the new tree
rather than wiring back any of the legacy build commands — those are no
longer maintained.
