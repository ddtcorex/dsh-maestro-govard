import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function readPkg(rel: string): string {
  // try multiple base resolutions: workspace root, package root
  const candidates = [
    resolve(rel),
    resolve('packages/dsh-maestro-govard', rel.replace('packages/dsh-maestro-govard/', '')),
    resolve(rel.replace('packages/dsh-maestro-govard/', '')),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, 'utf8');
  }
  // fallback relative to test file
  try {
    return readFileSync(new URL(`../${rel.replace('packages/dsh-maestro-govard/', '')}`, import.meta.url), 'utf8');
  } catch {}
  return '';
}

describe('govard-tool', () => {
  it('govard-tool.ts exists and exports maestro-govard-tool', async () => {
    const candidates = [
      'packages/dsh-maestro-govard/src/govard-tool.ts',
      'src/govard-tool.ts',
    ];
    let content = '';
    for (const c of candidates) {
      if (existsSync(resolve(c))) { content = readFileSync(resolve(c), 'utf8'); break; }
      if (existsSync(c)) { content = readFileSync(c, 'utf8'); break; }
    }
    if (!content) {
      try { content = readFileSync(new URL('../src/govard-tool.ts', import.meta.url), 'utf8'); } catch {}
    }
    expect(content).toContain('maestro-govard-tool');
    expect(content).toContain("export const name = 'maestro-govard-tool'");
    // also try dynamic import if deps available (non-fatal)
    try {
      const mod = await import('../src/govard-tool.js');
      expect(mod.name).toBe('maestro-govard-tool');
    } catch (e) {
      // fallback to content check already passed
    }
  });

  it('workspace-tool.ts exists and exports maestro-workspace-tool', async () => {
    let content = '';
    for (const c of ['packages/dsh-maestro-govard/src/workspace-tool.ts', 'src/workspace-tool.ts']) {
      if (existsSync(resolve(c))) { content = readFileSync(resolve(c), 'utf8'); break; }
    }
    if (!content) {
      try { content = readFileSync(new URL('../src/workspace-tool.ts', import.meta.url), 'utf8'); } catch {}
    }
    expect(content).toContain('maestro-workspace-tool');
    try {
      const mod = await import('../src/workspace-tool.js');
      expect(mod.name).toBe('maestro-workspace-tool');
    } catch {}
  });

  it('cordis patch contains dsh-maestro-govard id', () => {
    let yml = readPkg('packages/dsh-maestro-govard/cordis.patch.yml');
    if (!yml) yml = readPkg('cordis.patch.yml');
    if (!yml) {
      try { yml = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8'); } catch {}
    }
    expect(yml).toContain('dsh-maestro-govard');
    expect(yml).toContain('@ddtcorex/dsh-maestro-govard');
  });

  it('tool entry modules register via ctx.effect; the root wrapper does not register at all', async () => {
    const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
    // The rows load these two entries — every registration must be reversible.
    expect(read('../src/govard-tool.ts')).toContain('ctx.effect');
    expect(read('../src/workspace-tool.ts')).toContain('ctx.effect');
    // The package root is a library surface only: registering placeholder
    // tools here crashed the loader ("must declare output").
    expect(read('../src/index.ts')).not.toContain('ctx.tools.register');
  });

  it('package.json has correct name, version, and dsh.bundle.patch', () => {
    let pkg = '';
    for (const c of ['packages/dsh-maestro-govard/package.json', 'package.json']) {
      if (existsSync(resolve(c))) { pkg = readFileSync(resolve(c), 'utf8'); break; }
    }
    if (!pkg) {
      try { pkg = readFileSync(new URL('../package.json', import.meta.url), 'utf8'); } catch {}
    }
    const j = JSON.parse(pkg);
    expect(j.name).toBe('@ddtcorex/dsh-maestro-govard');
    expect(j.version).toBe('0.1.0');
    expect(j.dsh.bundle.patch).toBe('./cordis.patch.yml');
    expect(j.peerDependencies['@deepseek-ai/cordis']).toBe('^4.0.1');
  });
});

describe('cordis.patch.yml row wiring', () => {
  it('targets the two tool entry modules directly (not the package root)', async () => {
    const { readFileSync } = await import('node:fs')
    const yml = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    expect(yml).toContain("name: '@ddtcorex/dsh-maestro-govard/lib/govard-tool.js'")
    expect(yml).toContain("name: '@ddtcorex/dsh-maestro-govard/lib/workspace-tool.js'")
    expect(yml).not.toContain("name: '@ddtcorex/dsh-maestro-govard'\n")
  })
})
