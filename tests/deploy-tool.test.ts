import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The bridge must stay a thin argv mapper: the tools are worth testing at the
// boundary they own — the arguments handed to the govard binary and the way a
// failure is reported — not by asserting their source text.
type Registered = {
  name: string;
  description: string;
  // defineTool normalises the parameter spec into a JSON schema before the row
  // sees it: `required` arrives as a name list, not per property.
  parameters: {
    required?: readonly string[];
    properties?: Record<string, { enum?: readonly string[] }>;
  };
  execute: (args: Record<string, unknown>) => Promise<{ text: string }>;
};

/** argvLog is the file the stub govard appends its own argv to, one call per line. */
let stubDir = '';
let argvLog = '';
let previousPath = '';

function installStub(body: string): void {
  const stub = join(stubDir, 'govard');
  writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$*" >> "$GOVARD_ARGV_LOG"\n${body}\n`);
  chmodSync(stub, 0o755);
}

function calls(): string[] {
  try {
    return readFileSync(argvLog, 'utf8').split('\n').filter((line) => line !== '');
  } catch {
    return [];
  }
}

async function tools(): Promise<Map<string, Registered>> {
  const mod = await import('../src/host/deploy-tool.js');
  const registered = new Map<string, Registered>();
  const ctx = {
    tools: {
      register(definition: Registered) {
        registered.set(definition.name, definition);
      },
    },
    effect(factory: () => unknown) {
      factory();
    },
  };
  mod.apply(ctx as never, { rootPath: stubDir, timeoutMs: 5_000 });
  return registered;
}

beforeEach(() => {
  stubDir = mkdtempSync(join(tmpdir(), 'govard-deploy-stub-'));
  argvLog = join(stubDir, 'argv.log');
  process.env.GOVARD_ARGV_LOG = argvLog;
  previousPath = process.env.PATH ?? '';
  process.env.PATH = `${stubDir}:${previousPath}`;
});

afterEach(() => {
  process.env.PATH = previousPath;
  delete process.env.GOVARD_ARGV_LOG;
  rmSync(stubDir, { recursive: true, force: true });
});

describe('deploy-tool registration', () => {
  it('exports the module name the cordis row expects', async () => {
    const mod = await import('../src/host/deploy-tool.js');
    expect(mod.name).toBe('maestro-govard-deploy-tool');
    expect(mod.inject).toEqual(['tools']);
  });

  it('registers exactly the two read-only deploy tools', async () => {
    const registered = await tools();
    expect([...registered.keys()].sort()).toEqual(['govard_deploy_check', 'govard_deploy_plan']);
  });

  it('describes both tools as read-only', async () => {
    const registered = await tools();
    expect(registered.get('govard_deploy_plan')!.description).toContain('Read-only');
    expect(registered.get('govard_deploy_check')!.description).toContain('Read-only');
  });

  it('requires the remote, because govard resolves no default', async () => {
    // Verified live against the CLI: `govard deploy plan` with neither a
    // positional remote nor --remote exits 2 with "a remote is required", so a
    // schema that let the call through would only produce a failed invocation.
    const registered = await tools();
    for (const name of ['govard_deploy_plan', 'govard_deploy_check']) {
      const parameters = registered.get(name)!.parameters;
      expect(parameters.required, `${name} must require remote`).toContain('remote');
      expect(parameters.properties?.build?.enum).toEqual(['auto', 'server', 'artifact']);
    }
  });
});

describe('govard_deploy_plan argv', () => {
  it('runs `deploy plan <remote> --build auto` when only the remote is given', async () => {
    installStub('echo "plan"');
    const registered = await tools();
    const result = await registered.get('govard_deploy_plan')!.execute({ remote: 'production' });
    expect(calls()).toEqual(['deploy plan production --build auto']);
    // stdout is handed over verbatim, newline included — the bridge does not
    // reformat what the CLI printed.
    expect(result.text.trim()).toBe('plan');
  });

  it('maps remote, build mode and artifact dir onto the CLI', async () => {
    installStub('echo "plan"');
    const registered = await tools();
    await registered.get('govard_deploy_plan')!.execute({
      remote: 'production',
      build: 'artifact',
      artifactDir: 'artifacts',
    });
    expect(calls()).toEqual(['deploy plan production --build artifact --artifact-dir artifacts']);
  });

  it('offers no --json, because `deploy plan` accepts but ignores it', async () => {
    // Measured against govard 1.72.0-18-ga9dcca5: the plan printer never reads
    // the flag, so the text tree comes back either way. Advertising it would
    // promise an output format the command does not produce.
    const registered = await tools();
    expect(registered.get('govard_deploy_plan')!.parameters.properties).not.toHaveProperty('json');
  });

  it('falls back to a readable message when the plan prints nothing', async () => {
    installStub('true');
    const registered = await tools();
    const result = await registered.get('govard_deploy_plan')!.execute({ remote: 'production' });
    expect(result.text).toContain('nothing to print');
  });
});

describe('govard_deploy_check argv', () => {
  it('runs `deploy check <remote> --build auto` when only the remote is given', async () => {
    installStub('echo "ok"');
    const registered = await tools();
    await registered.get('govard_deploy_check')!.execute({ remote: 'production' });
    expect(calls()).toEqual(['deploy check production --build auto']);
  });

  it('maps the same parameters onto `deploy check`', async () => {
    installStub('echo "ok"');
    const registered = await tools();
    await registered.get('govard_deploy_check')!.execute({
      remote: 'staging',
      build: 'server',
      artifactDir: 'out',
    });
    expect(calls()).toEqual(['deploy check staging --build server --artifact-dir out']);
  });
});

describe('failure reporting', () => {
  it('surfaces govard own CAPABILITY_MISSING envelope rather than a Docker message', async () => {
    // deploy check needs ssh, not docker: the shared Docker wording would send the
    // operator looking at the wrong runtime.
    installStub('echo "CAPABILITY_MISSING: ssh is not available" >&2; exit 3');
    const registered = await tools();
    await expect(registered.get('govard_deploy_check')!.execute({ remote: 'production' })).rejects.toThrow(
      /CAPABILITY_MISSING: ssh is not available/,
    );
    await expect(registered.get('govard_deploy_check')!.execute({ remote: 'production' })).rejects.not.toThrow(/Docker/);
  });

  it('reports any other non-zero exit with its code and output', async () => {
    installStub('echo "target is not reachable" >&2; exit 1');
    const registered = await tools();
    await expect(registered.get('govard_deploy_check')!.execute({ remote: 'production' })).rejects.toThrow(
      /Exit 1: target is not reachable/,
    );
  });

  it('fails with a configuration error message on exit 4', async () => {
    installStub('echo "deploy.settings.symfony_env: unknown key" >&2; exit 4');
    const registered = await tools();
    await expect(registered.get('govard_deploy_plan')!.execute({ remote: 'production' })).rejects.toThrow(
      /Exit 4: deploy\.settings\.symfony_env: unknown key/,
    );
  });
});

describe('bundle wiring', () => {
  it('cordis.patch.yml loads deploy-tool.js as its own row', () => {
    const yml = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
    expect(yml).toContain("name: '@ddtcorex/dsh-maestro-govard/lib/deploy-tool.js'");
    expect(yml).toContain('id: dsh-maestro-govard-deploy');
  });

  it('the package root re-exports the module without registering tools', () => {
    const index = readFileSync(new URL('../src/host/index.ts', import.meta.url), 'utf8');
    expect(index).toContain("export * as DeployTool from './deploy-tool.js'");
    expect(index).not.toContain('ctx.tools.register');
  });
});
