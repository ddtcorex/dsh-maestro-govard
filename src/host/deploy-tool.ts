import { spawn } from 'node:child_process'
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
 * `--json` is deliberately not passed: `govard deploy plan` accepts the flag but
 * its printer never reads it (measured against 1.72.0-18-ga9dcca5 — the text
 * tree comes back either way), and a bridge that offered it would be advertising
 * an output format the command does not produce.
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
  const rootPath = config.rootPath ?? process.cwd()
  const timeoutMs = config.timeoutMs ?? 300_000

  ctx.tools.register(defineTool({
    name: 'govard_deploy_plan',
    description:
      'Show the resolved Govard deploy plan for one remote — every task in order, its source and where it runs — '
      + 'without connecting to the target. Read-only: nothing is executed and the host needs no ssh, rsync or Docker.',
    parameters: {
      remote: { type: 'string', required: true, description: 'Remote from .govard.yml, e.g. "production". Required: govard resolves no default remote.' },
      build: { type: 'string', enum: ['auto', 'server', 'artifact'], description: 'Where the build runs: auto (default), server or artifact.' },
      artifactDir: { type: 'string', description: 'Artifact directory a build produced, when build is "artifact".' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) {
      const result = await run('govard', deployArgv('plan', args), rootPath, timeoutMs)
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
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) {
      const result = await run('govard', deployArgv('check', args), rootPath, timeoutMs)
      if (result.code !== 0) throw failed(result)
      return succeeded(result, 'The target passed the deploy preflight.')
    },
  }))
}
