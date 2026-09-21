import { ToolId } from '../i18n/types';

/**
 * Preview images for the Home tool cards — never live output from that
 * specific tool, just a representative visual, so a "coming soon" card
 * never implies the feature already produces results.
 *
 * frontend/public/images/home/ — purpose-made mockups (each literally
 * depicts that tool's own UI/concept: the floor plan for Planta Humanizada,
 * the object-removal brush for Editor IA, the angle carousel for
 * Multiângulo, etc.).
 * frontend/public/images/sales/ — real architectural photos already
 * shipped with the sales page, reused for the tools that don't have a
 * purpose-made mockup.
 */
export const TOOL_PREVIEW_IMAGES: Record<ToolId, string> = {
  render: '/images/sales/facade-after.jpg',
  plantaHumanizada: '/images/home/tool-floor-plan.png',
  imagemPorTexto: '/images/sales/gallery-15.jpg',
  ideaGenerator: '/images/home/tool-idea-generator.png',
  videoIa: '/images/sales/gallery-06.jpg',
  videoEditor: '/images/home/tool-video-editor.png',
  melhorarRender: '/images/home/tool-improve-render.png',
  multiangulo: '/images/home/tool-multiangle.png',
  upscale: '/images/home/tool-upscale.png',
  editorIa: '/images/home/tool-editor-ia.png',
  arquitetoEstagiario: '/images/sales/gallery-02.jpg',
  financial: '/images/sales/gallery-08.jpg',
  projectFlow: '/images/sales/gallery-12.jpg',
};
