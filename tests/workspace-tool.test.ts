import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../src/workspace-tool.js';

interface RegisteredDef {
  name: string
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** Minimal ctx double capturing tools registered through the effect pattern. */
function captureRegistered(): { registered: RegisteredDef[]; ctx: never } {
  const registered: RegisteredDef[] = []
  const ctx = {
    tools: { register: (def: RegisteredDef) => { registered.push(def) } },
    effect(fn: () => void) { fn() },
  }
  return { registered, ctx: ctx as never }
}

function execFromSessionCwd(cwd: string): unknown {
  return {
    callId: 'call_test',
    name: 'maestro_read_file',
    arguments: {},
    signal: new AbortController().signal,
    agent: { session: { header: { cwd } } },
  }
}

const cleanup: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'maestro-workspace-tool-'))
  cleanup.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('workspace-tool session cwd resolution', () => {
  it('resolves relative paths against the calling agent session cwd when no rootPath is configured', async () => {
    const sessionDir = await tempDir()
    await writeFile(join(sessionDir, 'hello.txt'), 'from-session-cwd', 'utf-8')
    const { registered, ctx } = captureRegistered()
    apply(ctx)
    const read = registered.find((def) => def.name === 'maestro_read_file')
    expect(read).toBeDefined()
    // No config: the old behavior pinned the harness process.cwd() and missed
    // review worktrees; the fix resolves against the calling session cwd.
    const result = await read!.execute({ path: 'hello.txt' }, execFromSessionCwd(sessionDir)) as { text: string }
    expect(result.text).toBe('from-session-cwd')
  })

  it('keeps rejecting paths that escape the session cwd', async () => {
    const sessionDir = await tempDir()
    const outside = await tempDir()
    await writeFile(join(outside, 'secret.txt'), 'outside', 'utf-8')
    const { registered, ctx } = captureRegistered()
    apply(ctx)
    const read = registered.find((def) => def.name === 'maestro_read_file')!
    const denied = await read.execute({ path: '../secret.txt' }, execFromSessionCwd(sessionDir)) as { isError?: boolean }
    expect(denied.isError).toBe(true)
    // The denial must be about the SESSION root, not about a stale fallback:
    // reading the same relative path inside the session cwd still works.
    await writeFile(join(sessionDir, 'inner.txt'), 'inside', 'utf-8')
    const ok = await read.execute({ path: 'inner.txt' }, execFromSessionCwd(sessionDir)) as { text: string }
    expect(ok.text).toBe('inside')
  })

  it('still honors an explicit rootPath config over the session cwd', async () => {
    const pinnedRoot = await tempDir()
    const sessionDir = await tempDir()
    await writeFile(join(pinnedRoot, 'pinned.txt'), 'from-pinned-root', 'utf-8')
    const { registered, ctx } = captureRegistered()
    apply(ctx, { rootPath: pinnedRoot })
    const read = registered.find((def) => def.name === 'maestro_read_file')!
    const result = await read.execute({ path: 'pinned.txt' }, execFromSessionCwd(sessionDir)) as { text: string }
    expect(result.text).toBe('from-pinned-root')
  })

  it('writes relative to the calling session cwd', async () => {
    const sessionDir = await tempDir()
    const { registered, ctx } = captureRegistered()
    apply(ctx)
    const write = registered.find((def) => def.name === 'maestro_write_file')!
    const result = await write.execute({ path: 'nested/out.txt', content: 'written' }, execFromSessionCwd(sessionDir)) as { written: boolean }
    expect(result.written).toBe(true)
    expect(await readFile(join(sessionDir, 'nested/out.txt'), 'utf-8')).toBe('written')
  })
});
