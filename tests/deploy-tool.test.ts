import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
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
  execute: (args: Record<string, unknown>, exec?: unknown) => Promise<{ text: string }>;
};

/** argvLog is the file the stub govard appends its own argv to, one call per line. */
/** t_cleanup holds directories a test created outside the stub workspace. */
const t_cleanup: string[] = [];

let stubDir = '';
let argvLog = '';
let cwdLog = '';
let previousPath = '';

function installStub(body: string): void {
  const stub = join(stubDir, 'govard');
  writeFileSync(
    stub,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "$GOVARD_ARGV_LOG"\nprintf '%s\\n' "$PWD" >> "$GOVARD_CWD_LOG"\n${body}\n`,
  );
  chmodSync(stub, 0o755);
}

/** cwds is the directory each stub invocation ran in, in order. */
function cwds(): string[] {
  try {
    return readFileSync(cwdLog, 'utf8').split('\n').filter((line) => line !== '');
  } catch {
    return [];
  }
}

function calls(): string[] {
  try {
    return readFileSync(argvLog, 'utf8').split('\n').filter((line) => line !== '');
  } catch {
    return [];
  }
}

/** sessionCtx is the execution context a ToolRuntime passes to execute(). */
function sessionCtx(cwd: string): unknown {
  return { agent: { session: { header: { cwd } } } };
}

/**
 * tools applies the module the way the profile would, and returns the registered
 * definitions with the execution context a ToolRuntime supplies defaulted in.
 *
 * `configuredRoot` is only set when a test passes one, because "no rootPath
 * configured" is itself a case under test: the tool then has to fall back to the
 * session's cwd, not to whatever directory the host process happens to sit in.
 */
async function tools(configuredRoot?: string, sessionCwd: string = stubDir): Promise<Map<string, Registered>> {
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
  const config: { rootPath?: string; timeoutMs: number } = { timeoutMs: 5_000 };
  if (configuredRoot !== undefined) config.rootPath = configuredRoot;
  mod.apply(ctx as never, config);

  for (const [toolName, definition] of registered) {
    const original = definition.execute;
    registered.set(toolName, {
      ...definition,
      execute: (args, exec) => original(args, exec ?? sessionCtx(sessionCwd)),
    });
  }
  return registered;
}

beforeEach(() => {
  stubDir = mkdtempSync(join(tmpdir(), 'govard-deploy-stub-'));
  // The default root the module is configured with has to look like a Govard
  // project: the tools refuse to run in a directory that belongs to none.
  writeFileSync(join(stubDir, '.govard.yml'), 'project_name: stub\n');
  argvLog = join(stubDir, 'argv.log');
  cwdLog = join(stubDir, 'cwd.log');
  process.env.GOVARD_ARGV_LOG = argvLog;
  process.env.GOVARD_CWD_LOG = cwdLog;
  previousPath = process.env.PATH ?? '';
  process.env.PATH = `${stubDir}:${previousPath}`;
});

afterEach(() => {
  process.env.PATH = previousPath;
  delete process.env.GOVARD_ARGV_LOG;
  delete process.env.GOVARD_CWD_LOG;
  rmSync(stubDir, { recursive: true, force: true });
  while (t_cleanup.length > 0) {
    const dir = t_cleanup.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
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
    expect(calls()).toEqual(['deploy plan production --build auto --json']);
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
    expect(calls()).toEqual(['deploy plan production --build artifact --artifact-dir artifacts --json']);
  });

  it('always asks for the machine-readable plan', async () => {
    // govard 1.72.0-18-ga9dcca5 registered --json on `deploy plan` and never read
    // it, so the bridge deliberately did not pass it. The command now emits a
    // `kind: "plan"` document, and a session gets the same shape a pipeline does.
    // It is not a parameter: there is no useful choice between the two, and the
    // human tree is what the terminal is for.
    installStub('echo "{}"');
    const registered = await tools();
    await registered.get('govard_deploy_plan')!.execute({ remote: 'production' });
    expect(calls()).toEqual(['deploy plan production --build auto --json']);
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

// The tools run govard in the *bridge's* working directory unless told
// otherwise, and the host process's cwd is whatever `dsh web` was started from
// — on this machine a different Govard project entirely. A plan for the project
// a session is actually working in therefore has to say where that project is,
// exactly as govard_audit_lint takes `worktreePath`.
describe('the project the tools run against', () => {
  /** projectWithConfig creates a directory that looks like a Govard project. */
  function projectWithConfig(name: string, withConfig = true): string {
    const dir = join(stubDir, name);
    mkdirSync(dir, { recursive: true });
    if (withConfig) writeFileSync(join(dir, '.govard.yml'), 'project_name: sample\n');
    return dir;
  }

  it('runs in the project the caller names, not in the host cwd', async () => {
    installStub('echo "{}"');
    const project = projectWithConfig('site');
    const registered = await tools();

    await registered.get('govard_deploy_plan')!.execute({ remote: 'production', projectPath: project });

    expect(cwds()).toEqual([project]);
    expect(calls()).toEqual(['deploy plan production --build auto --json']);
  });

  it('falls back to the session cwd before the host cwd', async () => {
    installStub('echo "{}"');
    const project = projectWithConfig('session-site');
    // No configured root: the resolution goes to the session's workspace.
    const registered = await tools(undefined, project);

    await registered.get('govard_deploy_plan')!.execute({ remote: 'production' }, sessionCtx(project));

    expect(cwds()).toEqual([project]);
  });

  it('prefers an explicitly configured root over the session cwd', async () => {
    installStub('echo "{}"');
    const configured = projectWithConfig('configured-site');
    const session = projectWithConfig('session-site');
    const registered = await tools(configured);

    await registered.get('govard_deploy_plan')!.execute({ remote: 'production' }, sessionCtx(session));

    expect(cwds()).toEqual([configured]);
  });

  it('lets the caller override the configured root', async () => {
    installStub('echo "{}"');
    const configured = projectWithConfig('configured-site');
    const requested = projectWithConfig('requested-site');
    const registered = await tools(configured);

    await registered.get('govard_deploy_plan')!.execute({ remote: 'production', projectPath: requested });

    expect(cwds()).toEqual([requested]);
  });

  it('refuses a projectPath that holds no Govard project, naming the path', async () => {
    installStub('echo "{}"');
    // Outside the stub workspace: a directory under it would inherit the stub
    // project's .govard.yml and legitimately be part of that project.
    const empty = mkdtempSync(join(tmpdir(), 'govard-no-project-'));
    t_cleanup.push(empty);
    const registered = await tools();

    await expect(
      registered.get('govard_deploy_plan')!.execute({ remote: 'production', projectPath: empty }),
    ).rejects.toThrow(new RegExp(`no \\.govard\\.yml at or above ${empty.replace(/[.\\/]/g, '\\$&')}`));
    // Nothing was run: a plan for the wrong directory is worse than no plan.
    expect(calls()).toEqual([]);
  });

  it('accepts a subdirectory of a project, the way govard itself searches upward', async () => {
    installStub('echo "{}"');
    const project = projectWithConfig('deep-site');
    const nested = join(project, 'app', 'code');
    mkdirSync(nested, { recursive: true });
    const registered = await tools();

    await registered.get('govard_deploy_plan')!.execute({ remote: 'production', projectPath: nested });

    expect(cwds()).toEqual([nested]);
  });

  it('gives govard_deploy_check the same project resolution', async () => {
    installStub('echo "ok"');
    const project = projectWithConfig('check-site');
    const registered = await tools();

    await registered.get('govard_deploy_check')!.execute({ remote: 'production', projectPath: project }, sessionCtx(stubDir));

    expect(cwds()).toEqual([project]);
    expect(calls()).toEqual(['deploy check production --build auto']);
  });

  it('exposes projectPath on both tools, never as a required argument', async () => {
    const registered = await tools();
    for (const name of ['govard_deploy_plan', 'govard_deploy_check']) {
      const parameters = registered.get(name)!.parameters;
      expect(parameters.properties, `${name} must offer projectPath`).toHaveProperty('projectPath');
      expect(parameters.required ?? [], `${name} must not require projectPath`).not.toContain('projectPath');
      expect(parameters.required ?? [], `${name} still requires remote`).toContain('remote');
    }
  });
});
