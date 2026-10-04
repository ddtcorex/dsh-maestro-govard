import { describe, it, expect } from 'vitest'
import { collectLintFindings, lintResultText, cleanJson } from '../src/host/audit-lint-tool.js'

describe('cleanJson', () => {
  it('strips the pterm multi-space ERROR trailer so stdout parses', () => {
    const raw = '{"status":"failed"}\n  ERROR   audit run 20260903T165720Z-f2782c96/run-0001 reported failed checks\n'
    expect(cleanJson(raw)).toBe('{"status":"failed"}')
    expect(() => JSON.parse(cleanJson(raw))).not.toThrow()
  })
})

const compatFinding = { tool: 'M2-LINT-COMPAT', message: 'Internal error: Class "Zend_Db_Select" not found while analysing file /source/app/code/Acme/X.php' }
const phpcsFinding = { tool: 'phpcs', path: 'a.php', line: 10, rule: 'Magento2.Security.Xss', message: 'x' }

function envelope(findings: unknown[]): unknown {
  // Live shape (govard audit run): jobs[].evidence.php_results[].findings
  return { jobs: [{ evidence: { php_results: [{ php_version: '8.2', findings }] } }] }
}

describe('collectLintFindings', () => {
  it('collects nested envelope findings into buckets incl. compat', () => {
    const out = collectLintFindings(envelope([compatFinding, phpcsFinding]))
    expect(out.compat).toHaveLength(1)
    expect(out.compat[0].message).toContain('Zend_Db_Select')
    expect(out.phpcsViolations).toHaveLength(1)
    expect(out.total).toBe(2)
  })
  it('still reads the legacy top-level findings array', () => {
    const out = collectLintFindings({ findings: [phpcsFinding] })
    expect(out.phpcsViolations).toHaveLength(1)
    expect(out.total).toBe(1)
  })
  it('returns empty buckets when no findings shape matches', () => {
    expect(collectLintFindings({ status: 'passed' }).total).toBe(0)
  })
  it('emits lossless JSON: no undefined values in any entry (DSH rejects them)', () => {
    const out = collectLintFindings(envelope([{ tool: 'M2-LINT-COMPAT', message: 'x' }, { tool: 'phpcs' }]))
    for (const bucket of [out.compat, out.phpcsViolations, out.phpstanErrors]) {
      for (const entry of bucket as Array<Record<string, unknown>>) {
        expect(Object.values(entry).some((v) => v === undefined)).toBe(false)
      }
    }
    expect(JSON.parse(JSON.stringify(out))).toEqual(JSON.parse(JSON.stringify(JSON.parse(JSON.stringify(out)))))
  })
})

describe('lintResultText with compat', () => {
  it('counts compat and shows its message', () => {
    const text = lintResultText({ ok: false, exitCode: 1, lint: { phpcs: { violations: [] }, phpstan: { errors: [] }, pubMediaGuard: { violations: [] }, compat: { findings: [{ tool: 'M2-LINT-COMPAT', message: 'Internal error: Class "Zend_Db_Select" not found' }] } }, summary: { findingCount: 1 }, diagnostics: '' } as never)
    expect(text).toContain('1 finding(s)')
    expect(text).toContain('compat 1')
    expect(text).toContain('Zend_Db_Select')
  })
})
