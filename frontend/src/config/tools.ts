import type { LucideIcon } from 'lucide-react';
import { Clapperboard, Columns3, GraduationCap, Lightbulb, LayoutGrid, Maximize2, PenSquare, RotateCw, Sparkles, Type, Video, Wallet, Wand2 } from 'lucide-react';
import { ToolId } from '../i18n/types';
import { PlanId } from './plans';

export type ToolGroup = 'create' | 'edit' | 'assist' | 'management';

/**
 * Three distinct, non-overlapping states — do not conflate them:
 * - 'available': fully functional, open to everyone.
 * - 'premium': fully functional, but restricted to a plan (see `requiredPlan`).
 *   Never used for a tool that isn't actually built yet.
 * - 'comingSoon': not built yet. Never shown with the gold Premium indicator,
 *   even if the eventual tool will end up being plan-gated.
 */
export type ToolStatus = 'available' | 'premium' | 'comingSoon';

export interface ToolDefinition {
  id: ToolId;
  path: string;
  icon: LucideIcon;
  group: ToolGroup;
  status: ToolStatus;
  /**
   * Only meaningful when status === 'premium' — which plan unlocks this tool.
   * Purely presentational (drives the sidebar tooltip copy) until real
   * subscription state exists; no access check is performed against it yet.
   */
  requiredPlan?: PlanId;
}

/**
 * Single source of truth for every planned tool's metadata (icon, route, group,
 * availability). AppSidebar, Home and the router all read from this list instead
 * of maintaining separate copies — change a tool here and it updates everywhere.
 */
export const TOOLS: ToolDefinition[] = [
  { id: 'render', path: '/render', icon: Sparkles, group: 'create', status: 'available' },
  { id: 'plantaHumanizada', path: '/planta-humanizada', icon: LayoutGrid, group: 'create', status: 'available' },
  { id: 'imagemPorTexto', path: '/imagem-por-texto', icon: Type, group: 'create', status: 'available' },
  { id: 'ideaGenerator', path: '/gerador-de-ideias', icon: Lightbulb, group: 'create', status: 'available' },
  { id: 'videoIa', path: '/video-ia', icon: Video, group: 'create', status: 'available' },
  { id: 'videoEditor', path: '/video-editor', icon: Clapperboard, group: 'edit', status: 'available' },
  { id: 'melhorarRender', path: '/melhorar-render', icon: Wand2, group: 'edit', status: 'comingSoon' },
  { id: 'multiangulo', path: '/multiangulo', icon: RotateCw, group: 'edit', status: 'comingSoon' },
  { id: 'upscale', path: '/upscale', icon: Maximize2, group: 'edit', status: 'comingSoon' },
  { id: 'editorIa', path: '/editor-ia', icon: PenSquare, group: 'edit', status: 'comingSoon' },
  { id: 'arquitetoEstagiario', path: '/arquiteto-estagiario', icon: GraduationCap, group: 'assist', status: 'available' },
  { id: 'financial', path: '/financeiro', icon: Wallet, group: 'management', status: 'available' },
  { id: 'projectFlow', path: '/project-flow', icon: Columns3, group: 'management', status: 'available' },
];

export function getTool(id: ToolId): ToolDefinition {
  const tool = TOOLS.find((t) => t.id === id);
  if (!tool) throw new Error(`Unknown tool: ${id}`);
  return tool;
}

export function toolsByGroup(group: ToolGroup): ToolDefinition[] {
  return TOOLS.filter((t) => t.group === group);
}
