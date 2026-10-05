import { describe, it, expect } from 'vitest'

type Reg = { name: string; description?: string; parameters?: { properties?: Record<string, { description?: string }> } }
function cap() {
  const r: Reg[] = []
  return { r, ctx: { tools: { register: (d: Reg) => r.push(d) }, effect(fn: () => void) { fn() } } as unknown }
}

describe('govard_shell phpunit guidance', () => {
  it('teaches the Magento phpunit invocation, never the bare binary', async () => {
    const { apply } = await import('../src/host/govard-tool.js')
    const { r, ctx } = cap()
    apply(ctx as never, {})
    const shell = r.find((t) => t.name === 'govard_shell')
    expect(shell).toBeDefined()
    const text = `${shell!.description} ${shell!.parameters?.properties?.command?.description}`
    expect(text).toContain('-c dev/tests/unit/phpunit.xml.dist')
    expect(text).not.toContain('"vendor/bin/phpunit"')
  })
})
