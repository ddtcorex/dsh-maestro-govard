// Library surface only. The Cordis rows live in cordis.patch.yml and target the
// entry modules directly (govard-tool / workspace-tool / audit-lint-tool /
// deploy-tool); registering placeholder tools from here crashed the loader with
// "must declare output".
export * as GovardTool from './govard-tool.js';
export * as WorkspaceTool from './workspace-tool.js';
export * as DeployTool from './deploy-tool.js';
