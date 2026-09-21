import OpenAI, { toFile } from 'openai';
import { openaiLogger } from '../lib/logger';
import { AppError } from '../lib/errors';
import { describeOpenAiError, logFields, toAppError } from '../lib/openaiErrors';
import {
  OPENAI_ARCHITECT_CHAT_MAX_OUTPUT_TOKENS,
  OPENAI_ARCHITECT_CHAT_MODEL,
  OPENAI_ARCHITECT_CHAT_TIMEOUT_MS,
  OPENAI_ARCHITECT_TRANSCRIBE_MODEL,
  OPENAI_ARCHITECT_TRANSCRIBE_TIMEOUT_MS,
} from '../config/openaiModels';
import { ARCHITECT_CHAT_SYSTEM_PROMPT } from '../config/architectChat';

/**
 * OpenAI integration for Arquiteto Estagiário. Two independent calls:
 *
 *   - transcribeAudio(): one /v1/audio/transcriptions call per audio
 *     attachment (never sent to the chat model as raw audio).
 *   - streamChatReply(): one streamed /v1/responses call — text deltas are
 *     handed to the caller as they arrive (for the SSE response to the
 *     browser), and the full text + usage/request id are returned at the end.
 *
 * store:false always: nothing about a conversation is kept on OpenAI's side
 * between calls — the full turn history is resent as `input` every time,
 * exactly like providers/openaiAstra.ts does for its own (unrelated) calls.
 * No `tools` field is ever sent. maxRetries: 0 — no silent retry, no fallback
 * model. Image/audio bytes are only ever sent from the server; never logged.
 */

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new AppError('INVALID_API_KEY', 'OPENAI_API_KEY is not configured on the server.', undefined, 500);
  client = new OpenAI({ apiKey, maxRetries: 0 });
  return client;
}

export interface TranscribeAudioResult {
  text: string;
}

/** Transcribes one audio attachment. Throws AppError (never silently returns an empty transcript) so a failed transcription fails the whole message and refunds — the user's audio would otherwise be silently dropped from the assistant's context. */
export async function transcribeAudio(buffer: Buffer, mime: string, filename: string): Promise<TranscribeAudioResult> {
  const openai = getClient();
  try {
    const file = await toFile(buffer, filename, { type: mime });
    const response = await openai.audio.transcriptions.create({ file, model: OPENAI_ARCHITECT_TRANSCRIBE_MODEL }, { maxRetries: 0, timeout: OPENAI_ARCHITECT_TRANSCRIBE_TIMEOUT_MS });
    const text = typeof response === 'object' && response !== null && 'text' in response ? String((response as { text: unknown }).text ?? '') : '';
    return { text };
  } catch (err) {
    const info = describeOpenAiError(err);
    openaiLogger.error('OpenAI audio transcription HTTP error', logFields(info, OPENAI_ARCHITECT_TRANSCRIBE_MODEL));
    throw err instanceof AppError ? err : toAppError(info, 'audio transcription');
  }
}

export type ChatTurnRole = 'user' | 'assistant';

/** One text-only turn from the conversation's history (attachments never replay past the message that introduced them — only their transcript/description text does, already folded into that turn's content by the caller). */
export interface ChatHistoryTurn {
  role: ChatTurnRole;
  content: string;
}

export interface ChatImagePart {
  buffer: Buffer;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
}

export interface StreamChatReplyParams {
  history: ChatHistoryTurn[];
  /** The CURRENT user turn's text (may be empty if only attachments were sent). */
  currentText: string;
  /** The CURRENT user turn's images only — history turns never resend their images. */
  currentImages: ChatImagePart[];
  onDelta: (textChunk: string) => void;
}

export interface StreamChatReplyResult {
  text: string;
  requestId: string | null;
  usage: { inputTokens: number | null; cachedInputTokens: number | null; outputTokens: number | null; totalTokens: number | null } | null;
}

export async function streamChatReply(params: StreamChatReplyParams): Promise<StreamChatReplyResult> {
  const openai = getClient();
  const input: OpenAI.Responses.EasyInputMessage[] = params.history.map((turn) => ({ role: turn.role, content: turn.content }));

  const currentContent: OpenAI.Responses.ResponseInputContent[] = [];
  if (params.currentText) currentContent.push({ type: 'input_text', text: params.currentText });
  for (const img of params.currentImages) currentContent.push({ type: 'input_image', image_url: `data:${img.mime};base64,${img.buffer.toString('base64')}`, detail: 'auto' });
  if (currentContent.length === 0) currentContent.push({ type: 'input_text', text: '(no message text)' });
  input.push({ role: 'user', content: currentContent });

  let fullText = '';
  try {
    const stream = openai.responses.stream(
      {
        model: OPENAI_ARCHITECT_CHAT_MODEL,
        instructions: ARCHITECT_CHAT_SYSTEM_PROMPT,
        input,
        max_output_tokens: OPENAI_ARCHITECT_CHAT_MAX_OUTPUT_TOKENS,
        store: false,
      },
      { maxRetries: 0, timeout: OPENAI_ARCHITECT_CHAT_TIMEOUT_MS }
    );
    stream.on('response.output_text.delta', (event) => {
      fullText += event.delta;
      params.onDelta(event.delta);
    });
    const finalResponse = await stream.finalResponse();
    const usage = finalResponse.usage
      ? {
          inputTokens: finalResponse.usage.input_tokens ?? null,
          cachedInputTokens: finalResponse.usage.input_tokens_details?.cached_tokens ?? null,
          outputTokens: finalResponse.usage.output_tokens ?? null,
          totalTokens: finalResponse.usage.total_tokens ?? null,
        }
      : null;
    return { text: finalResponse.output_text || fullText, requestId: finalResponse.id ?? null, usage };
  } catch (err) {
    const info = describeOpenAiError(err);
    openaiLogger.error('OpenAI Arquiteto Estagiário HTTP error', logFields(info, OPENAI_ARCHITECT_CHAT_MODEL));
    throw err instanceof AppError ? err : toAppError(info, 'chat reply');
  }
}
