# Changelog

All notable changes to this project are documented in this file. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-09-14

### Fixed

- The deploy tools run against the project the session is working in. Both
  spawned govard in the bridge's own directory — wherever `dsh web` was started,
  which on a machine with several checkouts is a different Govard project — so a
  plan for a real project came back as `unknown remote "…"; configured remotes:
  (none)`. They now resolve `projectPath`, then the configured root, then the
  session's cwd, then the process cwd, exactly as `govard_audit_lint` already
  resolves its worktree, and refuse a directory outside any Govard project before
  spawning anything. (#20)

## [0.3.0] - 2026-09-14

### Added

- `govard_deploy_plan` and `govard_deploy_check` — the read-only half of the
  deploy pipeline: the resolved plan for one remote (no ssh, no rsync and no
  Docker) and the preflight against a target (ssh, changes nothing). The
  mutating subcommands stay in the terminal, where an operator sees the window
  and the prompt. (#17)

### Changed

- `govard_deploy_plan` asks for the `kind: "plan"` document govard introduced,
  so a session reads the same shape a pipeline does — including `run_on`, which
  the human tree does not print. Passing the flag is safe on older binaries too:
  govard registered it on the command before it read it. (#18)

## [0.2.0] - 2026-09-11

### Added

- `govard_audit_lint` forwards a `checks` selection (default `lint`) and asks the
  CLI for `--error-json`, so a capability failure arrives as typed evidence
  (`code`, `message`, `hint`, `capability`) instead of an unparsed stderr line.
  Container-free analysis is reachable from DSH as `checks: ["integrity"]`. (#14)

### Fixed

- Every failure path returns the declared output schema: `errors` and
  `diagnostics` are declared and `rawJson` is always an object, so the harness no
  longer rejects the result with "returned invalid output" in exactly the cases
  the capability contract exists for. (#15)
- Removed the dead duplicate source tree under `src/` that the build never
  compiled while the test suite imported it; `AGENTS.md` now documents the real
  `src/host/**` layout. (#14)

## [0.1.1] - 2026-09-02

### Changed

- Bump @deepseek-ai/* to 0.1.2-alpha.2, cordis 4.0.2 (#12), bump dsh-maestro-ci pin (#11).

### Fixed

- Complete public checklist — CHANGELOG, approval gate, host contract (#10).


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
