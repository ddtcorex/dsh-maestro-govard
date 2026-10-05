import { spawn } from 'node:child_process'
import { basename, dirname, resolve, sep } from 'node:path'
import { realpath } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name='maestro-govard-audit-lint-tool'
export const inject=['tools']
export const Config:z<{rootPath?:string, timeoutMs?:number, defaultBase?:string, allowXdebug?:boolean}> = z.object({rootPath:z.string(), timeoutMs:z.number(), defaultBase:z.string(), allowXdebug:z.boolean()})

export interface AuditLintOptions {
  checks?: string[]
  mode?: string
  scope?: string
  base?: string
  phpVersions?: string[]
  noLintResultCache?: boolean
  timeout?: string
  lintProvider?: string
  allowXdebug?: boolean
}

/** Explicit call base wins, then the review-wired default (MR base_sha). */
export function resolveLintBase(argsBase: string | undefined, defaultBase: string | undefined): string | undefined {
  return argsBase ?? defaultBase
}

export function buildAuditCliArgs(a: AuditLintOptions): string[] {
  const checks = a.checks && a.checks.length ? a.checks.join(',') : 'lint'
  const mode = a.mode ?? 'auto'
  const timeout = a.timeout ?? 'auto'
  const lintProvider = a.lintProvider ?? 'govard'
  const cliArgs=['audit','run','--checks',checks,'--format','json','--mode',mode,'--timeout',timeout,'--lint-provider',lintProvider]
  if(a.scope) cliArgs.push('--scope', a.scope)
  const base = resolveLintBase(a.base, undefined)
  if(base) cliArgs.push('--base', base)
  if(a.phpVersions && a.phpVersions.length) cliArgs.push('--php', a.phpVersions.join(','))
  if(a.noLintResultCache) cliArgs.push('--no-lint-result-cache')
  if(a.allowXdebug) cliArgs.push('--allow-xdebug')
  return cliArgs
}

interface SC{agent?:{session?:{header?:{cwd?:string}}}}
function workspaceRootFor(c:string|undefined, e:unknown):string{
  if(c!==undefined) return c
  const cwd=(e as SC|undefined)?.agent?.session?.header?.cwd
  return typeof cwd==='string'&&cwd!==''?cwd:process.cwd()
}
async function isInsideRoot(r:string,t:string):Promise<boolean>{
  const ar=resolve(r); const rs=resolve(ar,t)
  if(rs!==ar && !rs.startsWith(ar+sep)) return false
  let realRoot:string
  try{ realRoot=await realpath(ar) }catch{
    return true
  }
  let existing=rs
  const pending:string[]=[]
  while(true){
    let real:string
    try{ real=await realpath(existing) }catch(err){
      if((err as NodeJS.ErrnoException).code!=='ENOENT') return false
      const parent=dirname(existing)
      if(parent===existing) return false
      pending.unshift(basename(existing))
      existing=parent
      continue
    }
    const realTarget=pending.length>0 ? resolve(real, ...pending) : real
    if(realTarget!==realRoot && !realTarget.startsWith(realRoot+sep)) return false
    return true
  }
}
export function cleanJson(raw:string):string{
  // pterm pads the level name: "  ERROR   audit run ..." (multi-space).
  return raw.replace(/\n\s*ERROR\s+audit run.*$/s, '').replace(/\s{2,}ERROR\s+audit run.*$/s, '').trimEnd()
}

interface LintViolationLike { path?: string; line?: number; rule?: string; message?: string }

interface LintResultLike {
  ok: boolean
  exitCode?: number
  lint?: {
    phpcs?: { violations?: LintViolationLike[] }
    phpstan?: { errors?: LintViolationLike[] }
    pubMediaGuard?: { violations?: LintViolationLike[] }
  }
  summary?: { findingCount?: number }
  diagnostics?: string
}

/**
 * One-line-plus render for the agent: a bare "audit lint failed" hides the
 * violations the reviewer needs, so carry counts plus the top findings.
 */
export interface CollectedLintFindings {
  phpcsViolations: Array<{ path?: string; line?: number; column?: number; rule?: string; message?: string; severity?: string }>
  phpstanErrors: Array<{ path?: string; line?: number; message?: string }>
  pubMediaViolations: unknown[]
  compat: Array<{ tool?: string; path?: string; line?: number; rule?: string; message?: string }>
  total: number
}

/**
 * Collect findings across govard audit JSON shapes. The live envelope nests
 * them at results[].evidence.php_results[].findings (older callers used a
 * top-level findings array or evidence.php_results), and non-phpcs/phpstan
 * tools (e.g. M2-LINT-COMPAT internal errors) go to the compat bucket
 * instead of being silently dropped from counts.
 */
export function collectLintFindings(parsed: unknown): CollectedLintFindings {
  const p = (parsed ?? {}) as Record<string, any>
  const lists: unknown[][] = []
  if (Array.isArray(p.findings)) lists.push(p.findings)
  const ev = p.evidence as Record<string, any> | undefined
  if (Array.isArray(ev?.php_results)) lists.push(...ev.php_results.map((r: any) => r?.findings).filter(Array.isArray))
  if (Array.isArray(p.php_results)) lists.push(...p.php_results.map((r: any) => r?.findings).filter(Array.isArray))
  // Live shape (govard audit run): jobs[].evidence.php_results[].findings.
  // Older shapes (results[], bare evidence) kept for backward compatibility.
  for (const key of ['jobs', 'results'] as const) {
    if (!Array.isArray(p[key])) continue
    for (const r of p[key] as Array<Record<string, any>>) {
      const e = r?.evidence as Record<string, any> | undefined
      const pr = e?.php_results ?? r?.php_results
      if (Array.isArray(pr)) lists.push(...pr.map((x: any) => x?.findings).filter(Array.isArray))
      if (Array.isArray(r?.findings)) lists.push(r.findings)
    }
  }
  const out: CollectedLintFindings = { phpcsViolations: [], phpstanErrors: [], pubMediaViolations: [], compat: [], total: 0 }
  // DSH tool output must be lossless JSON: drop undefined fields, the
  // runtime rejects values that do not survive a JSON round-trip.
  const compact = (entry: Record<string, unknown>): Record<string, unknown> => {
    const kept: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(entry)) if (v !== undefined) kept[k] = v
    return kept
  }
  for (const list of lists) {
    for (const f of list as Array<Record<string, any>>) {
      if (f?.tool === 'phpstan') out.phpstanErrors.push(compact({ path: f.path, line: f.line, message: f.message }) as CollectedLintFindings['phpstanErrors'][number])
      else if (f?.tool === 'phpcs') {
        if (f.path?.includes('pub/media') || f.rule?.includes('PubMedia')) out.pubMediaViolations.push(f)
        else out.phpcsViolations.push(compact({ path: f.path, line: f.line, column: f.column, rule: f.rule, message: f.message, severity: f.severity }) as CollectedLintFindings['phpcsViolations'][number])
      } else if (f && typeof f === 'object') {
        out.compat.push(compact({ tool: f.tool, path: f.path, line: f.line, rule: f.rule, message: f.message }) as CollectedLintFindings['compat'][number])
      }
    }
  }
  out.total = out.phpcsViolations.length + out.phpstanErrors.length + out.pubMediaViolations.length + out.compat.length
  return out
}

export function lintResultText(v: LintResultLike): string {
  if (v.ok) return 'audit lint passed'
  const phpcs = v.lint?.phpcs?.violations ?? []
  const phpstan = v.lint?.phpstan?.errors ?? []
  const pubMedia = v.lint?.pubMediaGuard?.violations ?? []
  const compat = (v.lint as Record<string, any> | undefined)?.compat?.findings ?? []
  const total = v.summary?.findingCount ?? phpcs.length + phpstan.length + pubMedia.length + compat.length
  const bits: string[] = [`audit lint failed, ${total} finding(s) (phpcs ${phpcs.length}, phpstan ${phpstan.length}, pubMedia ${pubMedia.length}, compat ${compat.length})`]
  const top = [...phpcs.map(x => ({ ...x, tool: 'phpcs' })), ...phpstan.map(x => ({ ...x, tool: 'phpstan' })), ...pubMedia.map(x => ({ ...x, tool: 'pubMedia' })), ...compat.map((x: Record<string, any>) => ({ ...x, tool: x.tool ?? 'compat' }))].slice(0, 5)
  for (const f of top) bits.push(`- [${f.tool}] ${f.path ?? (f.message ?? '?').toString().slice(0, 120)}${f.path !== undefined ? `:${f.line ?? '?'}` : ''}${f.rule !== undefined ? ` ${f.rule}` : ''}`)
  if (v.exitCode !== undefined) bits.push(`exit ${v.exitCode}`)
  const diag = (v.diagnostics ?? '').split('\n')[0]?.trim()
  if (total === 0 && diag !== '' && diag !== undefined) bits.push(diag.slice(0, 200))
  return bits.join('\n')
}
// Govard 1.67 auto timeout: 90s-30m framework-aware (15m floor for wordpress/magento2 -> 22.5m auto).
// 900_000 ms (15 min) is the value ported from review. It is below the 22.5 min auto value for
// wordpress/magento2; the CLI enforces its own --timeout deadline first, this is only the outer kill.
const DEFAULT_TIMEOUT=900_000

function run(cmd:string, args:string[], cwd:string, timeoutMs:number):Promise<{code:number|null, stdout:string, stderr:string, timedOut:boolean}>{
  return new Promise((resolvePromise)=>{
    const child=spawn(cmd, args, {cwd})
    let stdout='', stderr=''
    let timedOut=false
    const timer=setTimeout(()=>{ timedOut=true; child.kill('SIGKILL') }, timeoutMs)
    child.stdout?.on('data',(c:Buffer)=> stdout+=c.toString())
    child.stderr?.on('data',(c:Buffer)=> stderr+=c.toString())
    child.on('error',(err:Error)=>{ clearTimeout(timer); resolvePromise({code:null, stdout, stderr: err.message, timedOut:false}) })
    child.on('close',(code)=>{ clearTimeout(timer); resolvePromise({code, stdout, stderr, timedOut}) })
  })
}

// auditErrorResult is the schema-compliant shape every failure path returns.
// Returning a bare {text} here tripped the declared output contract and the
// harness rejected the result instead of showing the diagnostics.
export function auditErrorResult(worktreePath:string, code:number|null, options:{errors:Array<Record<string,unknown>>, diagnostics?:string|null, rawJson?:Record<string,unknown>}={errors:[]}){
  return {
    ok:false,
    exitCode:code ?? -1,
    timedOut:false,
    worktreePath,
    lint:{phpcs:{violations:[]}, phpstan:{errors:[]}, pubMediaGuard:{violations:[]}},
    summary:{status:null, phpVersions:[], matrixComplete:false, findingCount:0, truncated:false},
    rawJson:options.rawJson ?? {},
    errors:options.errors,
    diagnostics:options.diagnostics ?? '',
  }
}

// auditChecksArg resolves the requested check selection, defaulting to the
// container-backed lint check the tool has always run.
export function auditChecksArg(raw: unknown): string[] {
  const requested = Array.isArray(raw)
    ? raw.map((check) => String(check).trim()).filter((check) => check !== '')
    : []
  return requested.length > 0 ? requested : ['lint']
}

// Retained as an exported helper for existing callers and tests; execute() now builds its argv
// with buildAuditCliArgs (pinned by the default-vector test in audit-lint-scope.test.ts).
// auditCliArgs builds the govard invocation. --error-json keeps a capability
// failure machine-readable instead of leaving it in stderr for the caller.
export function auditCliArgs(checks: string[]): string[] {
  return ['audit', 'run', '--checks', checks.join(','), '--format', 'json', '--error-json']
}

export function apply(ctx:Context, config:{rootPath?:string, timeoutMs?:number, defaultBase?:string, allowXdebug?:boolean}={}):void{
  const configuredRoot=config.rootPath
  const defaultTimeout=config.timeoutMs ?? DEFAULT_TIMEOUT
  const defaultBase=config.defaultBase
  // Worktree envs disable xdebug via .govard.local.yml, but govard's lint guard
  // probes the base .govard.yml only, so a caller opts out explicitly.
  const allowXdebug=config.allowXdebug ?? false
  ctx.effect(()=>ctx.tools.register(defineTool({
    name:'govard_audit_lint',
    description:'Run govard audit --format json and return structured results. Defaults to --checks lint (phpcs/phpstan in a container); pass checks:["integrity"] for container-free analysis (composer manifest/lock and Magento module/DI findings). Use before hand-parsing text. Govard 1.67+ uses --timeout auto (framework-aware 90s-30m, 22.5m for wordpress/magento2) by default. scope "diff" requires a base ref: pass base, or rely on the wired defaultBase (MR base_sha) when present. worktreePath overrides the configured root for this call.',
    parameters:{
      worktreePath:{type:'string'},
      checks:{type:'array', items:{type:'string'}},
      mode:{type:'string', enum:['auto','project','module_in_project','standalone']},
      phpVersions:{type:'array', items:{type:'string'}},
      noLintResultCache:{type:'boolean'},
      timeoutMs:{type:'number'},
      timeout:{type:'string', description:'Govard --timeout (e.g. auto, 300s, 15m, 0 for no timeout). Default auto.'},
      lintProvider:{type:'string', description:'--lint-provider (govard or external). Default govard.'},
      scope:{type:'string', enum:['project','diff']},
      base:{type:'string', description:'--base ref for diff scope'},
    },
    output:{
      schema:{
        type:'object', additionalProperties:false,
        properties:{
          ok:{type:'boolean', required:true},
          // -1 means "no exit code available" (for example the binary was not found).
          exitCode:{type:'number', required:true},
          timedOut:{type:'boolean', required:true},
          worktreePath:{type:'string', required:true},
          lint:{type:'object', required:true, additionalProperties:true},
          summary:{type:'object', required:true, additionalProperties:true},
          // No-parsed-payload branches report {} rather than null so the declared
          // shape holds on every path.
          rawJson:{type:'object', required:true, additionalProperties:true},
          errors:{type:'array', items:{type:'object', additionalProperties:true}, required:true},
          diagnostics:{type:'string'},
          sessionId:{type:'string'},
          runId:{type:'string'},
        }
      },
      render:(_a,v:LintResultLike)=>[{type:'text', text: lintResultText(v)}],
    },
    async execute(args, exec){
      const rawPath=(args as {worktreePath?:string}).worktreePath
      const root=workspaceRootFor(configuredRoot, exec)
      const worktreePath= rawPath ? resolve(root, rawPath) : root
      const checkPath= rawPath ?? ''
      if(checkPath!=='' && !(await isInsideRoot(root, checkPath))) return auditErrorResult(worktreePath, null, {errors:[{code:'path_escapes_root', message:`Path "${checkPath}" escapes the workspace root.`}]}) as never
      const timeoutMs=(args as {timeoutMs?:number}).timeoutMs ?? defaultTimeout
      if(timeoutMs<5000 || timeoutMs>1_800_000) return auditErrorResult(worktreePath, null, {errors:[{code:'timeout_out_of_range', message:'timeoutMs out of range 5000-1800000 (5s-30m). Use --timeout auto for framework-aware estimation.'}]}) as never

      const a=args as {checks?:string[]; mode?:string; scope?:string; base?:string; phpVersions?:string[]; noLintResultCache?:boolean; timeout?:string; lintProvider?:string; allowXdebug?:boolean}
      const base=resolveLintBase(a.base, defaultBase)
      if(a.scope==='diff' && base===undefined) return auditErrorResult(worktreePath, null, {errors:[{code:'base_required', message:'scope "diff" requires a base ref (govard --base): pass base explicitly (e.g. origin/master or the MR base_sha) or register this tool with defaultBase.'}]}) as never
      // --error-json keeps a capability failure machine-readable (see auditCliArgs).
      const cliArgs=[...buildAuditCliArgs({...a, checks:auditChecksArg(a.checks), base, allowXdebug:a.allowXdebug ?? allowXdebug}), '--error-json']
      const result=await run('govard', cliArgs, worktreePath, timeoutMs)
      if(result.timedOut){
        return {ok:false, exitCode:result.code ?? -1, timedOut:true, worktreePath, lint:{phpcs:{violations:[]}, phpstan:{errors:[]}, pubMediaGuard:{violations:[]}}, summary:{status:null, phpVersions:[], matrixComplete:false, findingCount:0, truncated:false}, rawJson:{}, errors:[{code:'timeout', message:`timed out after ${timeoutMs}ms` }], diagnostics:result.stderr.slice(0,4000)} as never
      }
      if(result.code===null && result.stderr.includes('ENOENT')){
        return {ok:false, exitCode:-1, timedOut:false, worktreePath, lint:{phpcs:{violations:[]}, phpstan:{errors:[]}, pubMediaGuard:{violations:[]}}, summary:{status:null, phpVersions:[], matrixComplete:false, findingCount:0, truncated:false}, rawJson:{}, errors:[{code:'govard_not_found', message:'govard binary not found'}], diagnostics:result.stderr.slice(0,4000)} as never
      }
      // clean JSON: strip trailing ERROR outside JSON (large audit 2.8MB case, sed '$d' before jq)
      const cleaned=cleanJson(result.stdout)
      let parsed:any=null
      try{ parsed=JSON.parse(cleaned) }catch{ parsed=null }
      if(!parsed){
        // fallback: try sed '$d' style, drop last line and retry
        const fallback=cleaned.split('\n').slice(0,-1).join('\n').trimEnd()
        try{ parsed=JSON.parse(fallback) }catch{}
        if(!parsed) {
          // also try raw stdout without cleaning as last resort diagnostics
          const tryStderr=cleanJson(result.stdout+result.stderr)
          try{ parsed=JSON.parse(tryStderr) }catch{}
        }
      }
      if(!parsed){
        return {ok:false, exitCode:result.code ?? -1, timedOut:false, worktreePath, lint:{phpcs:{violations:[]}, phpstan:{errors:[]}, pubMediaGuard:{violations:[]}}, summary:{status:null, phpVersions:[], matrixComplete:false, findingCount:0, truncated:false}, rawJson:{}, errors:[{code:'parse_error', message:'stdout not JSON'}], diagnostics:(cleaned+result.stderr).slice(0,4000)} as never
      }
      // The error envelope reports a missing capability (exit 3) as a typed code
      // rather than a parse failure.
      if(parsed.schema_version===1 && parsed.ok===false){
        const envelope=parsed.error ?? {}
        return {ok:false, exitCode:result.code ?? -1, timedOut:false, worktreePath, lint:{phpcs:{violations:[]}, phpstan:{errors:[]}, pubMediaGuard:{violations:[]}}, summary:{status:null, phpVersions:[], matrixComplete:false, findingCount:0, truncated:false}, rawJson:parsed, errors:[{code:envelope.code ?? 'error', message:envelope.message ?? 'govard audit failed', hint:envelope.hint, capability:envelope.capability}], diagnostics:result.stderr.slice(0,4000)} as never
      }
      const collected=collectLintFindings(parsed)
      const status=parsed.status ?? (result.code===0?'passed':'failed')
      const phpVersions=parsed.php_versions ?? parsed.phpVersions ?? []
      const findingCount=collected.total
      const sessionId=parsed.session_id ?? parsed.sessionId ?? undefined
      const runId=parsed.run_id ?? parsed.runId ?? undefined
      return {
        ok: result.code===0,
        exitCode: result.code ?? -1,
        timedOut:false,
        worktreePath,
        ...(sessionId ? { sessionId: String(sessionId) } : {}),
        ...(runId ? { runId: String(runId) } : {}),
        rawJson: parsed as Record<string, unknown>,
        summary:{status, phpVersions, matrixComplete:true, findingCount, truncated: findingCount>100},
        lint:{phpcs:{violations:collected.phpcsViolations}, phpstan:{errors:collected.phpstanErrors}, pubMediaGuard:{violations:collected.pubMediaViolations}, compat:{findings:collected.compat}},
        errors:[],
        diagnostics: result.stderr.slice(0,4000),
      } as never
    }
  })))
}
