/**
 * Prompt for the FLUX.1 Fill call in Planta Humanizada's mask-based
 * pipeline. Lighter-touch than plantaHumanizadaPromptBuilder.ts's prompt on
 * purpose: geometry protection here is enforced by the MASK itself (Fill
 * only ever touches white/editable pixels), not by prompt wording alone —
 * the base prompt still restates the intent for the model's own guidance,
 * but the real guarantee is the mask + the post-generation validation gate
 * in floorplanValidation.ts, not this text.
 */
const BASE_PROMPT = `Humanize this architectural floor plan inside the editable (white mask) area only.

Add realistic materials, textures, colors, warm lighting and a professional presentation quality to the floor and any surfaces within the editable area.

Keep the overall floor plan legible as a top-down architectural floor plan.

Do not add new walls, rooms or structural elements.

Do not add, invent or draw any text, letters, numbers, labels, dimension marks or annotations anywhere in the image — not even stylized or decorative ones. The floor plan's existing labels are already outside the editable area and must not be duplicated, echoed or imitated nearby.`;

/**
 * `semanticContext` is built from the OpenAI vision pipeline's own detected
 * rooms/furniture (see buildSemanticContext in routes/generateHumanizedFloorplan.ts)
 * — purely descriptive guidance for the model about what's already drawn
 * where, never a source of geometric authority (the mask alone still
 * decides what pixels Fill can touch).
 */
export function buildHumanizedFloorplanFillPrompt(customPrompt?: string, semanticContext?: string): string {
  let prompt = BASE_PROMPT;
  if (semanticContext?.trim()) {
    prompt += `\n\nDetected context, for guidance only (do not draw any labels, text or numbers based on this): ${semanticContext.trim()}`;
  }
  if (customPrompt?.trim()) {
    prompt += `\n\nAdditional instructions for the editable area: ${customPrompt.trim()}`;
  }
  return prompt;
}
