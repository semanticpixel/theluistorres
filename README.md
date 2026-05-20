# theluistorres

Personal Website — [projectluis.com](https://projectluis.com). Built with [Astro 5](https://astro.build); deployed to GitHub Pages on every push to `master`. The previous static `index.html` build is archived under [`legacy/`](./legacy) and no longer touches the production output.

## Stack

- **Astro 5** — multi-page, islands, zero-JS by default. Native i18n (`en` default + `/es`), View Transitions, MDX content collections.
- **Design tokens** in `src/styles/theme/` — primitives → semantic via `light-dark()`, cascade layered `@layer reset, theme, base, components, atoms;`.
- **CI gate** (`.github/workflows/ci.yml`) — typecheck (`astro check`), build, gzipped bundle budget (home JS &lt; 8 KB, CSS &lt; 12 KB), Lighthouse CI perf/a11y/SEO &ge; 98 on `/`, `/work`, `/work/linkedin-coach`.
- **Pages deploy** (`.github/workflows/deploy-pages.yml`) — uploads `dist/` as a Pages artifact and publishes via `actions/deploy-pages@v4`. Custom domain is checked in as `public/CNAME`, so the production hostname survives every deploy without manual reconfiguration.

## Toolchain

This repo uses **pnpm** as its package manager — pinned via the `packageManager` field in `package.json` and resolved by Corepack. The choice favours pnpm's content-addressable store (one copy of every package version across all projects on disk), strict peer-dependency resolution (catches version drift the moment it appears), and faster CI installs (the store doubles as a cross-build cache). Node `>= 20` is required.

### Bootstrap

```sh
corepack enable          # one-time, lets Node delegate to the pinned pnpm
pnpm install             # resolves dependencies into node_modules + writes pnpm-lock.yaml
```

The first `pnpm` invocation triggers Corepack to download the exact version declared in `packageManager`. No global pnpm install is necessary.
