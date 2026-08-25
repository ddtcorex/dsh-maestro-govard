# AGENTS.md — dsh-maestro-govard

> `CLAUDE.md` at the repo root is a symlink to `AGENTS.md`. Claude Code follows the same rule set as Codex CLI. Only edit `AGENTS.md` — never edit `CLAUDE.md` directly or replace the symlink with a copy.

## Purpose

Thin bridge plugin that exposes the Govard CLI to the DeepSeek Harness (DSH) as tools, so DSH agents can run Govard commands against framework projects.

Names by boundary: npm package = `@ddtcorex/dsh-maestro-govard`; Cordis patch row id = `dsh-maestro-govard`.

Part of the Maestro Harness suite. Host-only — the actual Govard logic lives in the separate Go `govard` repo.

## Layout

- `src/index.ts` — host `apply()`: registers the govard tools + RPC.
- `src/govard-tool.ts` — the `govard` tool (invokes the govard CLI, forwards env/up/sync/etc.).
- `src/workspace-tool.ts` — workspace helper tool.
- `tests/govard-tool.test.ts` — vitest suite.

## Development

```sh
pnpm verify   # tsc --noEmit
pnpm test     # vitest run
pnpm build    # tsc  -> lib/
```

## Git workflow

- Default branch `master`. No direct commits to `master` — use `feat/<topic>` / `fix/<topic>` and a PR.
- Conventional commits, imperative mood (`feat(govard): ...`, `fix(govard): ...`).
- One TDD task = one commit; never commit while `pnpm verify` is red.

## Conventions

- **Thin bridge only** — no Govard logic lives here. Delegate to the `govard` binary; do not re-implement commands, parsing, or framework detection.
- **No hard-coded frameworks/branches** — use registry/profile detection (via the CLI), never `if framework === "magento"`.
- Every subprocess spawn is a reversible effect (`ctx.effect(..., label)`); return disposers that kill children on teardown.

## Validation

`pnpm verify` + `pnpm test` green before any success claim. Govard runtime features must be validated live on a real project (Apache stack), not just with hermetic mocks.
