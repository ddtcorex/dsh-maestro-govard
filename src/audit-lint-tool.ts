import { spawn } from 'node:child_process'
import { resolve, sep } from 'node:path'
import { realpath } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name='maestro-govard-audit-lint-tool'
export const inject=['tools']
export const Config:z<{rootPath?:string, timeoutMs?:number}> = z.object({rootPath:z.string(), timeoutMs:z.number()})

interface SC{agent?:{session?:{header?:{cwd?:string}}}}
function workspaceRootFor(c:string|undefined, e:unknown):string{
  if(c!==undefined) return c
  const cwd=(e as SC|undefined)?.agent?.session?.header?.cwd
  return typeof cwd==='string'&&cwd!==''?cwd:process.cwd()
}
async function isInsideRoot(r:string,t:string):Promise<boolean>{
  const ar=resolve(r); const rs=resolve(ar,t)
  if(rs!==ar && !rs.startsWith(ar+sep)) return false
  try{ const rr=await realpath(ar); const rt=await realpath(rs); return rt===rr||rt.startsWith(rr+sep)}catch{return false}
}
const DEFAULT_TIMEOUT=120000

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

export function apply(ctx:Context, config:{rootPath?:string, timeoutMs?:number}={}):void{
  const configuredRoot=config.rootPath
  const defaultTimeout=config.timeoutMs ?? DEFAULT_TIMEOUT
  ctx.effect(()=>ctx.tools.register(defineTool({
    name:'govard_audit_lint',
    description:'Run govard audit --checks lint --format json and return structured phpcs/phpstan results. Use before hand-parsing text.',
    parameters:{
      worktreePath:{type:'string'},
      checks:{type:'array', items:{type:'string'}},
      mode:{type:'string', enum:['auto','project','module_in_project','standalone']},
      phpVersions:{type:'array', items:{type:'string'}},
      noLintResultCache:{type:'boolean'},
      timeoutMs:{type:'number'},
    },
    output:{
      schema:{
        type:'object', additionalProperties:false,
        properties:{
          ok:{type:'boolean', required:true},
          exitCode:{type:'number', required:true},
          timedOut:{type:'boolean', required:true},
          worktreePath:{type:'string', required:true},
          lint:{type:'object', required:true, additionalProperties:true},
          summary:{type:'object', required:true, additionalProperties:true},
          rawJson:{type:'object', required:true, additionalProperties:true},
        }
      },
      render:(_a,v:{ok:boolean})=>[{type:'text', text: v.ok? 'audit lint passed':'audit lint failed'}],
    },
    async execute(args, exec){
      const rawPath=(args as {worktreePath?:string}).worktreePath
      const root=workspaceRootFor(configuredRoot, exec)
      const worktreePath= rawPath ? resolve(root, rawPath) : root
      const checkPath= rawPath ?? ''
      if(checkPath!=='' && !(await isInsideRoot(root, checkPath))) return {text:`Path "${checkPath}" escapes the workspace root.`, truncated:false} as never
      const timeoutMs=(args as {timeoutMs?:number}).timeoutMs ?? defaultTimeout
      if(timeoutMs<5000 || timeoutMs>300000) return {text:'timeoutMs out of range 5000-300000', truncated:false} as never

      const cliArgs=['audit','run','--checks','lint','--format','json']
      const result=await run('govard', cliArgs, worktreePath, timeoutMs)
      if(result.timedOut){
        return {ok:false, exitCode:result.code, timedOut:true, worktreePath, lint:{phpcs:{violations:[]}, phpstan:{errors:[]}, pubMediaGuard:{violations:[]}}, summary:{status:null, phpVersions:[], matrixComplete:false, findingCount:0, truncated:false}, rawJson:null, errors:[{code:'timeout', message:`timed out after ${timeoutMs}ms` }], diagnostics:result.stderr.slice(0,4000)} as never
      }
      if(result.code===null && result.stderr.includes('ENOENT')){
        return {ok:false, exitCode:null, timedOut:false, worktreePath, lint:{phpcs:{violations:[]}, phpstan:{errors:[]}, pubMediaGuard:{violations:[]}}, summary:{status:null, phpVersions:[], matrixComplete:false, findingCount:0, truncated:false}, rawJson:null, errors:[{code:'govard_not_found', message:'govard binary not found'}], diagnostics:result.stderr.slice(0,4000)} as never
      }
      let parsed:any=null
      try{ parsed=JSON.parse(result.stdout) }catch{ parsed=null }
      if(!parsed){
        return {ok:false, exitCode:result.code, timedOut:false, worktreePath, lint:{phpcs:{violations:[]}, phpstan:{errors:[]}, pubMediaGuard:{violations:[]}}, summary:{status:null, phpVersions:[], matrixComplete:false, findingCount:0, truncated:false}, rawJson:null, errors:[{code:'parse_error', message:'stdout not JSON'}], diagnostics:(result.stdout+result.stderr).slice(0,4000)} as never
      }
      const findings:Array<any>=parsed.findings ?? parsed.evidence?.php_results?.flatMap((r:any)=>r.findings) ?? []
      // split
      const phpcsViolations:any[]=[]
      const phpstanErrors:any[]=[]
      const pubMediaViolations:any[]=[]
      for(const f of findings){
        if(f.tool==='phpstan') phpstanErrors.push({path:f.path, line:f.line, message:f.message})
        else if(f.tool==='phpcs'){
          if(f.path?.includes('pub/media') || f.rule?.includes('PubMedia')) pubMediaViolations.push(f)
          else phpcsViolations.push({path:f.path, line:f.line, column:f.column, rule:f.rule, message:f.message, severity:f.severity})
        }
      }
      const status=parsed.status ?? (result.code===0?'passed':'failed')
      const phpVersions=parsed.php_versions ?? parsed.phpVersions ?? []
      const findingCount=findings.length
      return {
        ok: result.code===0,
        exitCode: result.code,
        timedOut:false,
        worktreePath,
        sessionId: parsed.session_id ?? parsed.sessionId ?? null,
        runId: parsed.run_id ?? parsed.runId ?? null,
        rawJson: parsed,
        summary:{status, phpVersions, matrixComplete:true, findingCount, truncated: findingCount>100},
        lint:{phpcs:{violations:phpcsViolations}, phpstan:{errors:phpstanErrors}, pubMediaGuard:{violations:pubMediaViolations}},
        errors:[],
        diagnostics: result.stderr.slice(0,4000) || null,
      } as never
    }
  })))
}
