# theluistorres

Personal Website — [projectluis.com](https://projectluis.com).

## Toolchain

This repo uses **pnpm** as its package manager — pinned via the `packageManager` field in `package.json` and resolved by Corepack. The choice favours pnpm's content-addressable store (one copy of every package version across all projects on disk), strict peer-dependency resolution (catches version drift the moment it appears), and faster CI installs (the store doubles as a cross-build cache). Node `>= 20` is required.

### Bootstrap

```sh
corepack enable          # one-time, lets Node delegate to the pinned pnpm
pnpm install             # resolves dependencies into node_modules + writes pnpm-lock.yaml
```

The first `pnpm` invocation triggers Corepack to download the exact version declared in `packageManager`. No global pnpm install is necessary.
