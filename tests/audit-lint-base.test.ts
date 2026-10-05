import { describe, it, expect } from 'vitest'
import { resolveLintBase, buildAuditCliArgs } from '../src/host/audit-lint-tool.js'

describe('resolveLintBase', () => {
  it('prefers the explicit args base', () => {
    expect(resolveLintBase('origin/master', 'abc123')).toBe('origin/master')
  })
  it('falls back to the configured defaultBase', () => {
    expect(resolveLintBase(undefined, 'abc123')).toBe('abc123')
  })
  it('returns undefined when neither is given', () => {
    expect(resolveLintBase(undefined, undefined)).toBeUndefined()
  })
})

describe('buildAuditCliArgs', () => {
  it('passes --allow-xdebug only when configured (worktree envs disable xdebug via override)', () => {
    expect(buildAuditCliArgs({ allowXdebug: true })).toContain('--allow-xdebug')
    expect(buildAuditCliArgs({})).not.toContain('--allow-xdebug')
    expect(buildAuditCliArgs({ allowXdebug: false })).not.toContain('--allow-xdebug')
  })
  it('includes --scope diff --base when diffing', () => {
    const args = buildAuditCliArgs({ checks: ['lint'], mode: 'auto', timeout: 'auto', lintProvider: 'govard', scope: 'diff', base: 'abc123' })
    expect(args).toContain('--scope')
    expect(args).toContain('diff')
    expect(args).toContain('--base')
    expect(args).toContain('abc123')
  })
  it('omits --scope/--base for project scope', () => {
    const args = buildAuditCliArgs({ checks: ['lint'], mode: 'auto', timeout: 'auto', lintProvider: 'govard' })
    expect(args).not.toContain('--scope')
    expect(args).not.toContain('--base')
  })
})
