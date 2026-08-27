# Contributing to dsh-maestro-govard

Thank you for contributing to **dsh-maestro-govard** (`@ddtcorex/dsh-maestro-govard`) — a thin DeepSeek Harness (DSH) bridge that exposes the Govard CLI to DSH sessions as tools. The Govard engine itself is a separate Go codebase and binary; this package only bridges, it does not embed Go code.

Part of the Maestro Harness suite (`dsh-maestro-*`). Cordis patch row id: `dsh-maestro-govard`.

## Getting Started

1. **Fork and clone** `github.com/ddtcorex/dsh-maestro-govard`.
2. Install dependencies (requires Node.js 20+, pnpm 10+):

   ```bash
   pnpm install
   ```

3. Build the Cordis plugin (TypeScript → `lib/`):

   ```bash
   pnpm build        # runs tsc -> lib/
   ```

4. Open the project in your editor. Host logic lives at `src/`; tests at `tests/`.

## Development Workflow

Every change should follow TDD where applicable:

1. Write a failing test first, verify RED.
2. Implement the change, verify GREEN.
3. Commit that task before starting the next. Do not commit while tests are red.
4. Describe durable outcomes in the PR body.

## Branch Naming

Never commit directly to `master`. Start a feature branch per work session:

- `fix/<topic>` — bug fixes
- `feat/<topic>` — new features
- `docs/<topic>` — documentation-only changes

Rebase (not merge) when the base moves: `git fetch origin && git rebase origin/master`.

## Conventional Commits

All commit subjects **must** follow [Conventional Commits](https://www.conventionalcommits.org/) in imperative mood:

```
<type>(<scope>): <subject>

<body — why, not what>

Refs: #<issue>
```

- **Types (closed list):** `feat` `fix` `docs` `chore` `refactor` `perf` `test` `build` `ci` `revert`
- **Scope:** optional, without the `dsh-maestro-` prefix — e.g. `feat(govard):`, `fix(workspace):`, `docs(readme):`
- **Subject:** imperative, lowercase first word, ≤ 72 chars, no trailing period
- **Body:** explain *why* and trade-offs when non-trivial
- **Breaking changes:** `feat!: <subject>` plus a `BREAKING CHANGE:` footer

One TDD task = one commit while executing a plan; squash at merge time if the history reads better squashed.

## Validation

Run these before opening a PR (match depth to risk):

```bash
pnpm verify      # typecheck — tsc --noEmit
pnpm test        # vitest run
pnpm build       # tsc — ensures lib/ is not stale and lib/index.js exists (flat, rootDir: src/host)
```

Additional checks when relevant:

```bash
test -f lib/index.js   # Cordis contract — must be flat, not lib/host/
pnpm publish --dry-run --access public  # ensure no workspace:/link: in manifest
```

Govard runtime features (when touching Govard delegation) must be validated live on a real Govard-managed project (Apache stack), not just with hermetic mocks — see `AGENTS.md`.

Do not claim verified/done/clean without having actually run the checks — be ready to paste exact command output in the PR.

## Pull Requests

1. Push your branch and open a PR into `master`.
2. Fill out `.github/PULL_REQUEST_TEMPLATE.md` (Summary, Why, Changes, Validation, Linked Issues).
3. Link the PR to the plan that produced it when applicable.
4. Ensure CI (`pnpm verify` / `pnpm test` / `pnpm build` via `dsh-maestro-ci`) is green.

## Package Visibility

This package is public (`"private": false`). Never set `"private": true` in `package.json`. Publishing uses `pnpm publish --access public` (never plain `npm publish` — it leaves `workspace:` in the manifest).

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you agree to its terms.

## Questions or Security Reports

- General questions: open a GitHub Discussion or issue.
- Contact maintainer: [kaido4492@gmail.com](mailto:kaido4492@gmail.com)
- Security vulnerabilities: use GitHub's private advisory reporting at `https://github.com/ddtcorex/dsh-maestro-govard/security/advisories` — do not file a public issue.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
