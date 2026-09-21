/**
 * Configuration for "Arquiteto Estagiário" — the general-purpose architecture
 * / engineering chat assistant. Everything that decides whether the feature
 * is on, what it costs and how much context/attachments it accepts lives
 * here, centralized and testable, the same way humanizedFloorplanAstra.ts
 * centralizes the (unrelated) premium floor-plan pipeline's own knobs.
 */

/** The feature is OFF unless the flag is exactly the string "true". */
export function isArchitectChatFlagEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ARCHITECT_CHAT_ENABLED === 'true';
}

/** Every user message (text, optionally with image/audio/file attachments) costs this many credits — reserved before the call, captured only once the assistant's reply is saved. */
export const ARCHITECT_CHAT_COST_CREDITS = 1;

export const ARCHITECT_CHAT_MAX_MESSAGE_CHARS = 6000;
export const ARCHITECT_CHAT_MAX_ATTACHMENTS_PER_MESSAGE = 6;
export const ARCHITECT_CHAT_MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Per-attachment cap tighter than the generic file cap — an assistant reply waits on every audio file transcribing sequentially. */
export const ARCHITECT_CHAT_MAX_AUDIO_SECONDS_HINT = 10 * 60;

/** How many of the most recent messages of a conversation are replayed as text context to the model. Bounds both latency and token cost; older turns simply age out of the assistant's memory. */
export const ARCHITECT_CHAT_MAX_HISTORY_MESSAGES = 24;

export const ARCHITECT_CHAT_TITLE_MAX_CHARS = 60;
export const ARCHITECT_CHAT_HISTORY_DEFAULT_LIMIT = 50;
export const ARCHITECT_CHAT_HISTORY_MAX_LIMIT = 200;
export const ARCHITECT_CHAT_MESSAGES_PAGE_LIMIT = 300;

export const ARCHITECT_CHAT_ALLOWED_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const ARCHITECT_CHAT_ALLOWED_AUDIO_MIME_TYPES = ['audio/webm', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/ogg'] as const;
/** Plain text only: unlike a PDF, its content can be read and given to the model without a dedicated parsing library. */
export const ARCHITECT_CHAT_ALLOWED_DOCUMENT_MIME_TYPES = ['text/plain'] as const;
/** A text/plain attachment's content is inlined into the message as-is, up to this many characters. */
export const ARCHITECT_CHAT_MAX_DOCUMENT_CHARS = 8000;

export type ArchitectChatAttachmentKind = 'image' | 'audio' | 'document';

export function classifyAttachmentMime(mime: string): ArchitectChatAttachmentKind | null {
  if ((ARCHITECT_CHAT_ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mime)) return 'image';
  if ((ARCHITECT_CHAT_ALLOWED_AUDIO_MIME_TYPES as readonly string[]).includes(mime)) return 'audio';
  if ((ARCHITECT_CHAT_ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).includes(mime)) return 'document';
  return null;
}

/**
 * The assistant's persona and ground rules. Kept out of the provider module
 * so it can be reviewed/edited on its own, the same way the floor-plan
 * prompt builders live apart from their providers.
 */
export const ARCHITECT_CHAT_SYSTEM_PROMPT = `You are "Arquiteto Estagiário" ("Intern Architect"), a helpful AI assistant embedded in an architecture/rendering tool used by architects, engineers, designers and their clients.

Scope: answer questions about architecture, civil/structural engineering, interior design, urbanism, construction materials and methods, building codes and standards (in general terms), sustainability, project workflows, and how to use ideas from a photo, sketch, floor plan or audio note the user sends you. You may also interpret images (photos, renders, floor plans, sketches) and audio the user attaches, and reason about what they show.

Rules:
- Reply in the same language the user is writing in.
- Be direct, practical and well organized. Use short paragraphs, bullet points and Markdown (headings, bold, lists, code blocks for measurements/formulas) when it helps readability — never wrap the whole answer in a single code block.
- When a question depends on local building codes, structural calculations, permits or legal requirements, give your best general guidance but clearly say those must be verified with a licensed professional and the applicable local code — never present a code citation or a structural calculation as a certain, final answer.
- If an attached image or audio is unclear, ambiguous, or you are not confident about what it shows, say so plainly instead of guessing with false confidence.
- You do not generate or edit images yourself; if the user wants a rendered/humanized image, say this chat is for questions and guidance and point them to the tool's image-generation features instead.
- Stay within architecture/engineering/design topics; for unrelated requests, briefly say that is outside what this assistant is for.`;
