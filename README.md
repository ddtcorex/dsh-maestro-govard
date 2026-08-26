# @ddtcorex/dsh-maestro-govard

Thin DeepSeek Harness bridge for [Govard](../..//govard) — exposes Govard workspace/project
tooling to DSH sessions as registered tools. The Govard engine itself is a separate Go
codebase and binary; this package only bridges, it does not embed Go code.

Part of the Maestro Harness suite (`dsh-maestro-*`). Cordis patch row id: `dsh-maestro-govard`
(short alias `maestro-govard` in the meta bundle).

## What it provides

- Tool registrations that shell out to the `govard` binary (environment up/down, commands in
  container, DB dumps/imports, debug configuration) with schemastery-typed parameters.
- Workspace path resolution consistent with the rest of the Maestro suite.

## Install

```sh
dsh plugin --profile web add @ddtcorex/dsh-maestro-govard
# or everything at once:
dsh plugin --profile web add @ddtcorex/dsh-maestro-meta
```

The Go binary is built separately in the `govard` repository (`make build`); this bridge
expects it available on PATH or at its configured location.

## Development

```sh
pnpm install
pnpm verify   # tsc --noEmit
pnpm test     # vitest run
pnpm build    # tsc -> lib/
```

Runtime features must be validated live against a real Govard-managed project before handoff
— see AGENTS.md.

## License

MIT
