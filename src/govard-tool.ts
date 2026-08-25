import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'maestro-govard-tool'
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

function textResult(result: RunResult, successText: string): { text: string } {
  if (result.code !== 0) {
    throw new Error(`Exit ${result.code}: ${result.stderr || result.stdout}`)
  }
  return { text: result.stdout.length > 0 ? result.stdout : successText }
}

export function apply(ctx: Context, config: Config): void {
  const rootPath = config.rootPath ?? process.cwd()
  const timeoutMs = config.timeoutMs ?? 300_000

  async function ensureInitialized(): Promise<void> {
    if (existsSync(join(rootPath, '.govard.yml'))) return
    const result = await run('govard', ['init', '--framework', 'magento2', '-y'], rootPath, timeoutMs)
    if (result.code !== 0) throw new Error(`govard init failed: ${result.stderr || result.stdout}`)
  }

  ctx.tools.register(defineTool({
    name: 'govard_env_up',
    description: 'Bring up the local Magento 2 Govard environment for the current worktree, initializing it first if needed.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute() {
      await ensureInitialized()
      const result = await run('govard', ['up'], rootPath, timeoutMs)
      return textResult(result, 'Environment is up.')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'govard_shell',
    description: 'Run one non-interactive command inside the Govard-managed container (e.g. a test suite) and return its output.',
    parameters: {
      command: { type: 'string', required: true, description: 'Shell command to run inside the container, e.g. "vendor/bin/phpunit".' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) {
      const result = await run('govard', ['shell', '-c', args.command], rootPath, timeoutMs)
      return textResult(result, '(no output)')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'govard_env_down',
    description: 'Tear down the local Govard environment for the current worktree, removing volumes.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute() {
      const result = await run('govard', ['down', '-v'], rootPath, timeoutMs)
      return textResult(result, 'Environment is down.')
    },
  }))

  ctx.effect(() => async () => {
    await run('govard', ['down', '-v'], rootPath, timeoutMs).catch(() => undefined)
  }, 'govard-tool teardown')
}
