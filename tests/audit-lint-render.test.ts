import { describe, it, expect } from 'vitest'
import { lintResultText } from '../src/host/audit-lint-tool.js'

const failed = {
  ok: false,
  exitCode: 2,
  lint: {
    phpcs: { violations: [
      { path: 'a.php', line: 10, rule: 'Magento2.Security.Xss', message: 'x' },
      { path: 'a.php', line: 20, rule: 'Magento2.Strings', message: 'y' },
      { path: 'b.php', line: 5, rule: 'PSR12.General', message: 'z' },
    ] },
    phpstan: { errors: [{ path: 'c.php', line: 3, message: 'undefined' }] },
    pubMediaGuard: { violations: [] },
  },
  summary: { findingCount: 4 },
  diagnostics: 'some stderr output here',
}

describe('lintResultText', () => {
  it('failed render carries counts, top violations and exit code', () => {
    const text = lintResultText(failed as never)
    expect(text).toContain('audit lint failed')
    expect(text).toContain('4 finding(s)')
    expect(text).toContain('phpcs 3')
    expect(text).toContain('phpstan 1')
    expect(text).toContain('a.php:10')
    expect(text).toContain('Magento2.Security.Xss')
    expect(text).toContain('exit 2')
  })
  it('passed render stays short', () => {
    expect(lintResultText({ ok: true } as never)).toBe('audit lint passed')
  })
  it('failed render with no parsed findings still shows exit code and diagnostics head', () => {
    const text = lintResultText({ ok: false, exitCode: 1, lint: { phpcs: { violations: [] }, phpstan: { errors: [] }, pubMediaGuard: { violations: [] } }, summary: { findingCount: 0 }, diagnostics: 'boom details' } as never)
    expect(text).toContain('audit lint failed')
    expect(text).toContain('exit 1')
    expect(text).toContain('boom details')
  })
})
