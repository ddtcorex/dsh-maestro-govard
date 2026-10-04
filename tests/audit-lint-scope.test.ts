import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'

// Fake exec: records every spawn call and answers with a canned govard result.
const spawned: Array<{ cmd: string; args: string[]; cwd: string }> = []
vi.mock('node:child_process', () => ({
  spawn: (cmd: string, args: string[], opts: { cwd: string }) => {
    spawned.push({ cmd, args, cwd: opts.cwd })
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => {}
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from('{"status":"passed"}'))
      child.emit('close', 0)
    })
    return child
  },
}))

type Reg = { name: string; execute: (a: unknown, e: unknown) => Promise<unknown> }
const cleanup: string[] = []
async function tempDir() { const d = await mkdtemp(join(tmpdir(), 'auditscope-')); cleanup.push(d); return d }
afterEach(async () => { spawned.length = 0; await Promise.all(cleanup.splice(0).map(d => rm(d, { recursive: true, force: true }))) })
function cap() { const r: Reg[] = []; return { r, ctx: { tools: { register: (d: Reg) => r.push(d) }, effect(fn: () => void) { fn() } } as unknown } }
function exec(cwd: string): unknown { return { callId: 'c', name: 'govard_audit_lint', arguments: {}, signal: new AbortController().signal, agent: { session: { header: { cwd } } } } }

describe('govard_audit_lint scope and base', () => {
  it('registers govard_audit_lint', async () => {
    const { apply } = await import('../src/host/audit-lint-tool.js')
    const { r, ctx } = cap(); apply(ctx as never, {})
    expect(r[0].name).toBe('govard_audit_lint')
  })

  it('forwards scope diff with the explicit base to the CLI', async () => {
    const { apply } = await import('../src/host/audit-lint-tool.js')
    const { r, ctx } = cap(); apply(ctx as never, { rootPath: '/tmp/root' })
    await r[0].execute({ scope: 'diff', base: 'abc123' }, exec('/tmp/root'))
    const a = spawned[0].args
    expect(a[a.indexOf('--scope') + 1]).toBe('diff')
    expect(a[a.indexOf('--base') + 1]).toBe('abc123')
  })

  it('falls back to the configured defaultBase for scope diff', async () => {
    const { apply } = await import('../src/host/audit-lint-tool.js')
    const { r, ctx } = cap(); apply(ctx as never, { rootPath: '/tmp/root', defaultBase: 'basesha' })
    await r[0].execute({ scope: 'diff' }, exec('/tmp/root'))
    const a = spawned[0].args
    expect(a[a.indexOf('--base') + 1]).toBe('basesha')
  })

  it('refuses scope diff without any base and does not spawn govard', async () => {
    const { apply } = await import('../src/host/audit-lint-tool.js')
    const { r, ctx } = cap(); apply(ctx as never, { rootPath: '/tmp/root' })
    const res = await r[0].execute({ scope: 'diff' }, exec('/tmp/root')) as { ok: boolean; errors: Array<{ code: string }> }
    expect(res.ok).toBe(false)
    expect(res.errors[0].code).toBe('base_required')
    expect(spawned).toHaveLength(0)
  })

  it('passes --allow-xdebug when the tool config enables it', async () => {
    const { apply } = await import('../src/host/audit-lint-tool.js')
    const { r, ctx } = cap(); apply(ctx as never, { rootPath: '/tmp/root', allowXdebug: true })
    await r[0].execute({}, exec('/tmp/root'))
    expect(spawned[0].args).toContain('--allow-xdebug')
  })

  it('keeps the machine-readable error envelope flag on the CLI call', async () => {
    const { apply } = await import('../src/host/audit-lint-tool.js')
    const { r, ctx } = cap(); apply(ctx as never, { rootPath: '/tmp/root' })
    await r[0].execute({}, exec('/tmp/root'))
    expect(spawned[0].args).toContain('--error-json')
  })
})

describe('govard_audit_lint worktreePath', () => {
  it('runs govard in worktreePath when it is given', async () => {
    const { apply } = await import('../src/host/audit-lint-tool.js')
    const { r, ctx } = cap(); apply(ctx as never, {})
    const root = await tempDir()
    const wt = join(root, 'wt')
    await mkdir(wt)
    await r[0].execute({ worktreePath: 'wt' }, exec(root))
    expect(spawned).toHaveLength(1)
    expect(spawned[0].cwd).toBe(wt)
  })

  it('runs govard in the configured rootPath when worktreePath is absent', async () => {
    const { apply } = await import('../src/host/audit-lint-tool.js')
    const { r, ctx } = cap(); apply(ctx as never, { rootPath: '/tmp/configured-root' })
    await r[0].execute({}, exec('/somewhere/else'))
    expect(spawned[0].cwd).toBe('/tmp/configured-root')
  })

  it('still rejects a worktreePath that escapes the root', async () => {
    const { apply } = await import('../src/host/audit-lint-tool.js')
    const { r, ctx } = cap(); apply(ctx as never, {})
    const root = await tempDir()
    const res = await r[0].execute({ worktreePath: '../../etc' }, exec(root)) as { errors: Array<{ code: string }> }
    expect(res.errors[0].code).toBe('path_escapes_root')
    expect(spawned).toHaveLength(0)
  })
})
