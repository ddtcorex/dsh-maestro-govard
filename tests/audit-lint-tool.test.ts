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
    const {apply}=await import('../src/audit-lint-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    expect(r[0].name).toBe('govard_audit_lint')
  })
  it('rejects worktreePath escaping root', async ()=>{
    const {apply}=await import('../src/audit-lint-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    const res=await r[0].execute({worktreePath:'../../etc'}, exec(root)) as {text?:string}
    const txt=typeof res==='string'?res:(res as {text?:string}).text??JSON.stringify(res)
    expect(txt.toLowerCase()).toContain('escapes')
  })
  it('handles missing govard binary gracefully (govard_not_found)', async ()=>{
    const {apply}=await import('../src/audit-lint-tool.js')
    const {r,ctx}=cap(); apply(ctx as never,{})
    const root=await tempDir()
    const res=await r[0].execute({worktreePath: root, timeoutMs:5000}, exec(root)) as {ok:boolean, errors:Array<{code:string}>}
    // in CI sandbox govard not installed -> govard_not_found or parse_error, but tool must return ok:false with errors array
    expect(res.ok).toBe(false)
    expect(Array.isArray(res.errors)).toBe(true)
  })
})
