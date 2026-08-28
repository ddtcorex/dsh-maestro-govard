# Changelog

All notable changes to this project are documented in this file. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-28

Initial release of `@ddtcorex/dsh-maestro-govard`, a thin DeepSeek Harness bridge
that exposes the Govard Go binary to DSH agents as tools.

### Added

- **Govard tool (`govard`)** — spawns the `govard` CLI (`govard env up|down|sync`,
  container commands, DB operations) with session-cwd resolution, timeout handling
  and reversible `ctx.effect` teardown.
- **Workspace tools (`maestro_read_file`, `maestro_write_file`)** — file helpers
  that resolve paths against the calling agent session `header.cwd` (fallback to
  `process.cwd()`), with traversal and symlink escape guards.
- **Audit-lint tool (`govard_audit_lint`)** — runs `govard audit --checks lint`
  and strips the trailing `ERROR audit run … reported failed checks` line before
  JSON parsing, with bounded timeout and `isInsideRoot` guards.
- **Cordis rows** via `cordis.patch.yml` — three host entries
  (`dsh-maestro-govard`, `dsh-maestro-govard-workspace`,
  `dsh-maestro-govard-audit-lint`) that load the self-registering entry modules
  directly; the package root `src/index.ts` is a library surface only.
- **Host-only build contract** — `tsconfig.json` `rootDir: src/host` → flat
  `lib/index.js` (`lib/host/` would break plugin loading), `pnpm-workspace.yaml`
  `allowBuilds.esbuild: true`, and `packageManager: pnpm@11.7.0`.

[0.1.0]: https://github.com/ddtcorex/dsh-maestro-govard/releases/tag/v0.1.0
