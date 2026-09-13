# AGENTS.md — dsh-maestro-govard

> `CLAUDE.md` at the repo root is a symlink to `AGENTS.md`. Claude Code follows the same rule set as Codex CLI. Only edit `AGENTS.md` — never edit `CLAUDE.md` directly or replace the symlink with a copy.

## Purpose

Thin bridge plugin that exposes the Govard CLI to the DeepSeek Harness (DSH) as tools, so DSH agents can run Govard commands against framework projects.

Names by boundary: npm package = `@ddtcorex/dsh-maestro-govard`; Cordis patch row id = `dsh-maestro-govard`.

Part of the Maestro Harness suite. Host-only — the actual Govard logic lives in the separate Go `govard` repo.

## Layout

`tsconfig.json` builds `src/host/**` (rootDir `src/host`) to a flat `lib/`, which
is what `cordis.patch.yml` and the package `files` list reference. Sources live
there and nowhere else — a duplicate tree under `src/` was removed because edits
to it compiled to nothing and the vitest suite was asserting against it.

- `src/host/index.ts` — library surface re-exporting the tool modules.
- `src/host/govard-tool.ts` — container tools: `govard_env_up`, `govard_shell`, `govard_env_down`.
- `src/host/audit-lint-tool.ts` — `govard_audit_lint` (lint by default, `checks:["integrity"]` for container-free analysis).
- `src/host/deploy-tool.ts` — read-only deploy inspection: `govard_deploy_plan` and `govard_deploy_check`. The mutating deploy subcommands (`deploy`, `rollback`, `sandbox *`) are deliberately not exposed; a tool that changes a target needs its own confirmation protocol first.
- `src/host/workspace-tool.ts` — workspace file helpers.
- `tests/*.test.ts` — vitest suite, importing `../src/host/*.js`.

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
- **Always request approval before merge or release:** never merge a PR/MR or publish a release (`git tag`/`pnpm publish`/`gh release`) without an explicit human approval — request review (`gh pr ready` / `gh pr request-review` / ask in chat) and wait for `APPROVED`. This applies to every `master`/`main` merge and every `vX.Y.Z` tag.

## Conventions

- **Thin bridge only** — no Govard logic lives here. Delegate to the `govard` binary; do not re-implement commands, parsing, or framework detection.
- **No hard-coded frameworks/branches** — use registry/profile detection (via the CLI), never `if framework === "magento"`.
- Every subprocess spawn is a reversible effect (`ctx.effect(..., label)`); return disposers that kill children on teardown.

## Validation

`pnpm verify` + `pnpm test` green before any success claim. Govard runtime features must be validated live on a real project (Apache stack), not just with hermetic mocks.
