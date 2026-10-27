import { ArcTool, CircleTool, LineTool, PolylineTool, RectangleTool } from './drawing-tools';
import { ModifyTool, SelectTool } from './modify-tools';
import type { Tool, ToolContext, ToolId } from './types';

/** Creates a fresh tool instance. Tools hold per-activation state, so each activation gets a new one. */
export function createTool(id: ToolId, ctx: ToolContext): Tool {
  switch (id) {
    case 'select':
      return new SelectTool(ctx);
    case 'line':
      return new LineTool(ctx);
    case 'polyline':
      return new PolylineTool(ctx);
    case 'rectangle':
      return new RectangleTool(ctx);
    case 'circle':
      return new CircleTool(ctx);
    case 'arc':
      return new ArcTool(ctx);
    case 'move':
    case 'copy':
    case 'rotate':
      return new ModifyTool(ctx, id);
  }
}

export interface ToolInfo {
  readonly id: ToolId;
  readonly label: string;
  /** Single-key or command-line alias, uppercase. */
  readonly alias: string;
  readonly shortcut?: string;
}

/** Toolbar and command-line metadata. Order here is the toolbar order. */
export const TOOL_INFO: readonly ToolInfo[] = [
  { id: 'select', label: 'Select', alias: 'S', shortcut: 'Esc' },
  { id: 'line', label: 'Line', alias: 'L', shortcut: 'L' },
  { id: 'polyline', label: 'Polyline', alias: 'PL', shortcut: 'P' },
  { id: 'rectangle', label: 'Rectangle', alias: 'REC', shortcut: 'R' },
  { id: 'circle', label: 'Circle', alias: 'C', shortcut: 'C' },
  { id: 'arc', label: 'Arc', alias: 'A', shortcut: 'A' },
  { id: 'move', label: 'Move', alias: 'M', shortcut: 'M' },
  { id: 'copy', label: 'Copy', alias: 'CO', shortcut: 'O' },
  { id: 'rotate', label: 'Rotate', alias: 'RO', shortcut: 'T' },
];

export function toolInfo(id: ToolId): ToolInfo {
  const info = TOOL_INFO.find((t) => t.id === id);
  if (!info) throw new Error(`Unknown tool "${id}".`);
  return info;
}
