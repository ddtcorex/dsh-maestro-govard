import * as GovardTool from './govard-tool.js';
import * as WorkspaceTool from './workspace-tool.js';
export default {
  inject: ['tools'] as const,
  apply(ctx: any) {
    ctx.effect(() => ctx.tools.register((GovardTool as any).create ? (GovardTool as any).create() : { name: 'govard' }));
    ctx.effect(() => ctx.tools.register((WorkspaceTool as any).create ? (WorkspaceTool as any).create() : { name: 'workspace' }));
  }
};
