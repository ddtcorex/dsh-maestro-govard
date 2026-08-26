import { basename, dirname, resolve, sep } from 'node:path'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'maestro-workspace-tool'
export const inject = ['tools']

export interface Config {
  rootPath?: string
}

export const Config: z<Config> = z.object({
  rootPath: z.string(),
})

async function resolveInRoot(rootPath: string, requestedPath: string): Promise<string | undefined> {
  const absoluteRoot = resolve(rootPath)
  const target = resolve(absoluteRoot, requestedPath)
  if (target !== absoluteRoot && !target.startsWith(absoluteRoot + sep)) return undefined

  let realRoot: string
  try {
    realRoot = await realpath(absoluteRoot)
  } catch {
    return undefined
  }

  let existing = target
  const pending: string[] = []
  while (true) {
    let real: string
    try {
      real = await realpath(existing)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return undefined
      const parent = dirname(existing)
      if (parent === existing) return undefined
      pending.unshift(basename(existing))
      existing = parent
      continue
    }
    const realTarget = pending.length > 0 ? resolve(real, ...pending) : real
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) return undefined
    return target
  }
}

/**
 * Structural view of the tool run-context fields this tool needs. Mirrors the
 * `@deepseek-ai/dsh-tool-fs` session-cwd semantics: without an explicit pinned
 * root, relative paths resolve against the CALLING agent's per-session
 * workspace (`exec.agent.session.header.cwd`), so subagents whose session
 * lives in a checkout or review worktree read their own tree instead of the
 * harness host's `process.cwd()`.
 */
interface SessionCwdSource {
  agent?: { session?: { header?: { cwd?: string } } }
}

function workspaceRootFor(configuredRoot: string | undefined, exec: unknown): string {
  if (configuredRoot !== undefined) return configuredRoot
  const cwd = (exec as SessionCwdSource | undefined)?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd()
}

export function apply(ctx: Context, config: Config = {}): void {
  const configuredRoot = config.rootPath

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'maestro_read_file',
    description: 'Read a text file relative to the current workspace root.',
    parameters: {
      path: { type: 'string', required: true, description: 'Path relative to the workspace root.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const target = await resolveInRoot(workspaceRootFor(configuredRoot, exec), args.path)
      if (target === undefined) return { isError: true, text: `Path "${args.path}" escapes the workspace root.` } as never
      const text = await readFile(target, 'utf-8')
      return { text }
    },
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'maestro_write_file',
    description: 'Write a text file relative to the current workspace root, creating parent directories as needed.',
    parameters: {
      path: { type: 'string', required: true, description: 'Path relative to the workspace root.' },
      content: { type: 'string', required: true, description: 'File content to write.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { written: { type: 'boolean', required: true } } },
      render: (args) => [{ type: 'text', text: `Wrote ${args.path}` }],
    },
    async execute(args, exec) {
      const target = await resolveInRoot(workspaceRootFor(configuredRoot, exec), args.path)
      if (target === undefined) return { isError: true, text: `Path "${args.path}" escapes the workspace root.` } as never
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, args.content, 'utf-8')
      return { written: true }
    },
  })))
}
