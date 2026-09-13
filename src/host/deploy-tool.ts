import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

// The deploy surface a session may touch is deliberately the read-only half:
// `govard deploy plan` reads the project configuration and the recipe and never
// connects, and `govard deploy check` connects over ssh but changes nothing.
// `deploy`, `rollback` and `sandbox *` mutate a target — they stay in the
// terminal, where an operator sees the window and the prompt.
export const name = 'maestro-govard-deploy-tool'
export const inject = ['tools']

export interface Config {
  rootPath?: string
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  rootPath: z.string(),
  timeoutMs: z.number().min(1_000).default(300_000),
})

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

/** ExecContext is the slice of the execution context this tool reads. */
interface ExecContext {
  agent?: { session?: { header?: { cwd?: string } } }
}

/**
 * projectRootFor decides which directory govard runs in.
 *
 * The tools defer to a Govard project, and the host process's own directory is
 * not one: `dsh web` starts wherever it was launched, and on a machine with
 * several checkouts that is a different project — or none. So the resolution
 * order goes from most specific to least:
 *
 *   1. `projectPath`, the caller naming the project;
 *   2. the configured `rootPath`, for a profile pinned to one project;
 *   3. the session's cwd, which is the workspace the agent was started in;
 *   4. the process cwd, the last resort.
 *
 * This mirrors `govard_audit_lint`, which resolves its worktree the same way and
 * for the same reason.
 */
function projectRootFor(configured: string | undefined, exec: unknown, requested: unknown): string {
  if (typeof requested === 'string' && requested !== '') return resolve(requested)
  if (configured !== undefined && configured !== '') return configured
  const cwd = (exec as ExecContext | undefined)?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd()
}

/**
 * hasGovardConfig reports whether a directory is inside a Govard project.
 *
 * govard searches upward for `.govard.yml`, so a subdirectory of a project is a
 * legitimate answer; what must not happen is running in a directory that belongs
 * to no project at all, where the CLI's own complaint ("unknown remote …;
 * configured remotes: (none)") describes the wrong problem.
 */
function hasGovardConfig(dir: string): boolean {
  let current = resolve(dir)
  for (;;) {
    if (existsSync(join(current, '.govard.yml'))) return true
    const parent = dirname(current)
    if (parent === current) return false
    current = parent
  }
}

/**
 * resolveProject validates the directory the tools will run in.
 *
 * An empty directory is refused before anything is spawned: a plan for the wrong
 * project is worse than no plan, and the answer has to name the directory so the
 * caller can correct `projectPath`.
 */
function resolveProject(configured: string | undefined, exec: unknown, requested: unknown): string {
  const root = projectRootFor(configured, exec, requested)
  if (!hasGovardConfig(root)) {
    throw new Error(`no .govard.yml at or above ${root}; pass projectPath pointing at a Govard project`)
  }
  return root
}


function run(command: string, args: string[], cwd: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((promiseResolve, promiseReject) => {
    const child = spawn(command, args, { cwd })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      promiseReject(new Error(`"${command} ${args.join(' ')}" timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', (err) => {
      clearTimeout(timer)
      promiseReject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      promiseResolve({ code, stdout, stderr })
    })
  })
}

function succeeded(result: RunResult, fallback: string): { text: string } {
  return { text: result.stdout.length > 0 ? result.stdout : fallback }
}

/**
 * failed describes a non-zero exit.
 *
 * Exit 3 keeps govard's own envelope: it names the capability that is missing
 * and the hint that resolves it, and the capability differs per command —
 * `deploy check` needs ssh, not docker — so a message written here would point
 * the operator at the wrong runtime.
 */
function failed(result: RunResult): Error {
  const detail = (result.stderr || result.stdout).trim()
  if (result.code === 3) {
    return new Error(detail || 'CAPABILITY_MISSING: govard reported a missing capability')
  }
  return new Error(`Exit ${result.code}: ${detail}`)
}

/**
 * deployArgv maps the tool parameters onto the CLI, in the order its own help
 * shows them: the remote is positional, and `--build` is always explicit so the
 * plan a session reads is the plan the deploy would run.
 *
 * `--json` is not a parameter and is not added here: the plan asks for the
 * document itself (see the plan tool), because there is no useful choice between
 * the two shapes for a session and the human tree is what the terminal is for.
 */
function deployArgv(subcommand: string, args: Record<string, unknown>): string[] {
  const argv = ['deploy', subcommand]
  const remote = args.remote
  if (typeof remote === 'string' && remote !== '') argv.push(remote)
  const build = args.build
  argv.push('--build', typeof build === 'string' && build !== '' ? build : 'auto')
  const artifactDir = args.artifactDir
  if (typeof artifactDir === 'string' && artifactDir !== '') argv.push('--artifact-dir', artifactDir)
  return argv
}

export function apply(ctx: Context, config: Config): void {
  const configuredRoot = config.rootPath
  const timeoutMs = config.timeoutMs ?? 300_000

  ctx.tools.register(defineTool({
    name: 'govard_deploy_plan',
    description:
      'Show the resolved Govard deploy plan for one remote as its machine-readable document — every task in order with '
      + 'what it runs (or why this build mode skips it), where it runs, and the source of each hook — without connecting '
      + 'to the target. Read-only: nothing is executed and the host needs no ssh, rsync or Docker.',
    parameters: {
      remote: { type: 'string', required: true, description: 'Remote from .govard.yml, e.g. "production". Required: govard resolves no default remote.' },
      build: { type: 'string', enum: ['auto', 'server', 'artifact'], description: 'Where the build runs: auto (default), server or artifact.' },
      artifactDir: { type: 'string', description: 'Artifact directory a build produced, when build is "artifact".' },
      projectPath: { type: 'string', description: 'Absolute path of the Govard project to read. Defaults to the configured root, then the session workspace — without one of those the tools read whichever project the host process happens to sit in.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const projectRoot = resolveProject(configuredRoot, exec, args.projectPath)
      // The document, not the human tree: `kind: "plan"` plus one entry per step
      // with `implementation`, `command`, `skipped`, `skip_reason` and `run_on`.
      // A govard older than the plan-JSON change accepts the flag and ignores it
      // (it was registered before it was read), so this is safe on both.
      const result = await run('govard', [...deployArgv('plan', args), '--json'], projectRoot, timeoutMs)
      if (result.code !== 0) throw failed(result)
      return succeeded(result, 'The plan is empty: nothing to print.')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'govard_deploy_check',
    description:
      'Run the Govard deploy preflight against one remote: connectivity, permissions, layout and the publish strategy '
      + 'the target implies. Read-only — it connects over ssh (a missing capability is reported as CAPABILITY_MISSING) '
      + 'but changes nothing on the target.',
    parameters: {
      remote: { type: 'string', required: true, description: 'Remote from .govard.yml, e.g. "production". Required: govard resolves no default remote.' },
      build: { type: 'string', enum: ['auto', 'server', 'artifact'], description: 'Where the build runs: auto (default), server or artifact.' },
      artifactDir: { type: 'string', description: 'Artifact directory a build produced, when build is "artifact".' },
      projectPath: { type: 'string', description: 'Absolute path of the Govard project to read. Defaults to the configured root, then the session workspace — without one of those the tools read whichever project the host process happens to sit in.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const projectRoot = resolveProject(configuredRoot, exec, args.projectPath)
      const result = await run('govard', deployArgv('check', args), projectRoot, timeoutMs)
      if (result.code !== 0) throw failed(result)
      return succeeded(result, 'The target passed the deploy preflight.')
    },
  }))
}
