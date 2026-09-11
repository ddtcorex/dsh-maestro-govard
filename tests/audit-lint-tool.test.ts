import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Reg={name:string, execute:(a:unknown,e:unknown)=>Promise<unknown>}
const cleanup:string[]=[]
async function tempDir(){ const d=await mkdtemp(join(tmpdir(),'auditlint-')); cleanup.push(d); return d}
afterEach(async()=>{ await Promise.all(cleanup.splice(0).map(d=>rm(d,{recursive:true,force:true}))); vi.restoreAllMocks() })
function cap(){ const r:Reg[]=[]; return {r, ctx:{tools:{register:(d:Reg)=>r.push(d)}, effect(fn:()=>void){fn()}} as unknown}}
function exec(cwd:string):unknown{ return {callId:'c', name:'govard_audit_lint', arguments:{}, signal:new AbortController().signal, agent:{session:{header:{cwd}}}}}

describe('govard_audit_lint', ()=>{
  it('registers tool govard_audit_lint', async ()=>{
    const {apply}=await import('../src/host/audit-lint-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    expect(r[0].name).toBe('govard_audit_lint')
  })
  it('rejects worktreePath escaping root', async ()=>{
    const {apply}=await import('../src/host/audit-lint-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    const res=await r[0].execute({worktreePath:'../../etc'}, exec(root)) as {text?:string}
    const txt=typeof res==='string'?res:(res as {text?:string}).text??JSON.stringify(res)
    expect(txt.toLowerCase()).toContain('escapes')
  })
  it('handles missing govard binary gracefully (govard_not_found)', async ()=>{
    const {apply}=await import('../src/host/audit-lint-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    const res=await r[0].execute({worktreePath: root, timeoutMs:5000}, exec(root)) as {ok:boolean, errors:Array<{code:string}>}
    // in CI sandbox govard not installed -> govard_not_found or parse_error, but tool must return ok:false with errors array
    expect(res.ok).toBe(false)
    expect(Array.isArray(res.errors)).toBe(true)
  })

  it('defaults the check selection to lint', async ()=>{
    const {auditChecksArg}=await import('../src/host/audit-lint-tool.js')
    expect(auditChecksArg(undefined)).toEqual(['lint'])
    expect(auditChecksArg([])).toEqual(['lint'])
    expect(auditChecksArg(['  '])).toEqual(['lint'])
  })
  it('forwards an explicit check selection such as integrity', async ()=>{
    const {auditChecksArg}=await import('../src/host/audit-lint-tool.js')
    expect(auditChecksArg(['integrity'])).toEqual(['integrity'])
    expect(auditChecksArg(['lint','integrity'])).toEqual(['lint','integrity'])
  })
  it('requests the machine-readable error envelope', async ()=>{
    const {auditCliArgs}=await import('../src/host/audit-lint-tool.js')
    const args=auditCliArgs(['integrity'])
    expect(args).toContain('--error-json')
    expect(args[args.indexOf('--checks')+1]).toBe('integrity')
  })


  it('failure paths satisfy the declared output contract', async ()=>{
    const {auditErrorResult}=await import('../src/host/audit-lint-tool.js')
    const required=['ok','exitCode','timedOut','worktreePath','lint','summary','rawJson','errors']
    const result=auditErrorResult('/tmp/work', null, {errors:[{code:'parse_error', message:'stdout not JSON'}]}) as Record<string,unknown>
    for(const key of required){
      expect(Object.prototype.hasOwnProperty.call(result,key), `missing ${key}`).toBe(true)
    }
    // The harness rejects additional or misshapen properties; rawJson must be
    // an object on every path, including when nothing parsed.
    expect(typeof result.rawJson).toBe('object')
    expect(result.rawJson).not.toBeNull()
    expect(Array.isArray(result.errors)).toBe(true)
  })
  it('rejects a worktreePath outside the root with a schema-shaped result', async ()=>{
    const {apply}=await import('../src/host/audit-lint-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    const res=await r[0].execute({worktreePath:'../../etc'}, exec(root)) as Record<string,unknown>
    expect(res.ok).toBe(false)
    expect(Array.isArray(res.errors)).toBe(true)
    expect(res.rawJson).not.toBeNull()
  })

  it('cleanJson strips trailing ERROR outside JSON', async ()=>{
    const {cleanJson}=await import('../src/host/audit-lint-tool.js')
    const raw = `{"status":"failed"}  ERROR audit run 20260827T000425Z reported failed checks`
    expect(cleanJson(raw)).toEqual(`{"status":"failed"}`)
  })
  it('cleanJson strips trailing ERROR with newline', async ()=>{
    const {cleanJson}=await import('../src/host/audit-lint-tool.js')
    const raw = `{"status":"failed"}\n  ERROR audit run 20260827T000425Z reported failed checks`
    expect(cleanJson(raw)).toEqual(`{"status":"failed"}`)
  })
  it('cleanJson preserves valid JSON', async ()=>{
    const {cleanJson}=await import('../src/host/audit-lint-tool.js')
    expect(cleanJson(`{"ok":true}`)).toEqual(`{"ok":true}`)
  })
})
