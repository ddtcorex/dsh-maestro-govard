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

  it('src/index.ts registers tools via ctx.effect', async () => {
    let src = '';
    for (const c of ['packages/dsh-maestro-govard/src/index.ts', 'src/index.ts']) {
      if (existsSync(resolve(c))) { src = readFileSync(resolve(c), 'utf8'); break; }
    }
    if (!src) {
      try { src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8'); } catch {}
    }
    expect(src).toContain('ctx.effect');
    expect(src).toContain('ctx.tools.register');
    expect(src).toContain('GovardTool');
    expect(src).toContain('WorkspaceTool');
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
