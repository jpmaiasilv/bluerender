import { Request, Response, Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { AppError } from '../lib/errors';
import { serverLogger } from '../lib/logger';
import { requireAuth, AuthenticatedRequest } from '../middleware/requireAuth';
import { detectImageMimeType } from '../lib/fileSignature';
import {
  ARCHITECT_CHAT_COST_CREDITS,
  ARCHITECT_CHAT_HISTORY_DEFAULT_LIMIT,
  ARCHITECT_CHAT_HISTORY_MAX_LIMIT,
  ARCHITECT_CHAT_MAX_ATTACHMENTS_PER_MESSAGE,
  ARCHITECT_CHAT_MAX_DOCUMENT_CHARS,
  ARCHITECT_CHAT_MAX_FILE_BYTES,
  ARCHITECT_CHAT_MAX_HISTORY_MESSAGES,
  ARCHITECT_CHAT_MAX_MESSAGE_CHARS,
  ARCHITECT_CHAT_MESSAGES_PAGE_LIMIT,
  ARCHITECT_CHAT_TITLE_MAX_CHARS,
  classifyAttachmentMime,
  isArchitectChatFlagEnabled,
} from '../config/architectChat';
import { ActiveReservation, captureCredits, getWalletBackend, refundCredits, reserveCredits } from '../services/creditWallet';
import {
  ArchitectChatStore,
  ArchitectMessageUsage,
  ConversationRecord,
  MessageRecord,
  StoredAttachment,
  getArchitectChatStore,
} from '../services/architectChatStore';
import {
  ArchitectChatFileStorage,
  contentTypeForPath,
  getArchitectChatFileStorage,
  verifyFileToken,
} from '../storage/architectChatFiles';
import { ChatHistoryTurn, ChatImagePart, streamChatReply, transcribeAudio } from '../providers/openaiArchitectChat';
import { OPENAI_ARCHITECT_CHAT_MODEL } from '../config/openaiModels';
import { estimateArchitectChatCostUsd } from '../services/openaiArchitectChatCost';
import {
  ArchitectChatAttachmentDTO,
  ArchitectChatConfigResponse,
  ArchitectChatConversationDetailDTO,
  ArchitectChatConversationSummaryDTO,
  ArchitectChatMessageDTO,
} from '../types/architectChat';
import { ErrorCode } from '../types/api';

/**
 * Arquiteto Estagiário — the chat assistant. One credit per user turn
 * (text and/or attachments), reserved before anything else and captured only
 * once the assistant's reply is safely stored; any technical failure refunds
 * in full. The user's own message is stored as soon as it is safely received
 * (so it is never lost even if the model call itself fails) — only the
 * assistant's reply can end up marked 'failed'.
 */

const TOOL = 'architect_chat';
const NEW_CONVERSATION_SENTINEL = 'new';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: ARCHITECT_CHAT_MAX_FILE_BYTES, files: ARCHITECT_CHAT_MAX_ATTACHMENTS_PER_MESSAGE } });
const uploadAttachments = upload.array('attachments', ARCHITECT_CHAT_MAX_ATTACHMENTS_PER_MESSAGE);

export const architectChatRouter = Router();

// --- Helpers -----------------------------------------------------------------

const SAFE_ERROR_MESSAGES: Record<string, string> = {
  PROVIDER_UNAVAILABLE: 'The assistant is unavailable right now.',
  GENERATION_TIMEOUT: 'The assistant took too long to answer.',
  GENERATION_FAILED: 'The assistant could not answer.',
  VALIDATION_ERROR: 'The request was not accepted.',
  INVALID_API_KEY: 'The assistant is not available right now.',
  INSUFFICIENT_CREDITS: 'Not enough credits.',
  FILE_TOO_LARGE: 'One of the attached files is larger than the allowed size.',
  UNKNOWN_ERROR: 'Something went wrong.',
};

function sanitizedFailure(err: unknown): { code: ErrorCode; message: string } {
  const code = (err instanceof AppError && SAFE_ERROR_MESSAGES[err.code] ? err.code : 'UNKNOWN_ERROR') as ErrorCode;
  return { code, message: SAFE_ERROR_MESSAGES[code] ?? 'An unexpected error occurred.' };
}

function sendError(res: Response, err: unknown): void {
  if (err instanceof AppError) {
    res.status(err.httpStatus).json({ error: { code: err.code, message: err.message } });
    return;
  }
  serverLogger.error('Unexpected error handling architect chat request', err instanceof Error ? err.message : String(err));
  res.status(500).json({ error: { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred.' } });
}

export async function isArchitectChatAvailable(): Promise<boolean> {
  if (!isArchitectChatFlagEnabled() || !process.env.OPENAI_API_KEY) return false;
  try {
    await getWalletBackend();
    await getArchitectChatStore();
    await getArchitectChatFileStorage();
    return true;
  } catch {
    return false;
  }
}

function runUpload(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    uploadAttachments(req, res, (err: unknown) => {
      if (!err) return resolve();
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return reject(new AppError('FILE_TOO_LARGE', 'One of the attached files is larger than the allowed size.', undefined, 413));
      if (err instanceof multer.MulterError) return reject(new AppError('VALIDATION_ERROR', `Too many attachments (max ${ARCHITECT_CHAT_MAX_ATTACHMENTS_PER_MESSAGE}).`, undefined, 400));
      reject(new AppError('VALIDATION_ERROR', 'The attachment upload failed.', undefined, 400));
    });
  });
}

function deriveTitle(text: string): string {
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  if (!firstLine) return '';
  return firstLine.length > ARCHITECT_CHAT_TITLE_MAX_CHARS ? `${firstLine.slice(0, ARCHITECT_CHAT_TITLE_MAX_CHARS - 1)}…` : firstLine;
}

interface PreparedAttachment {
  kind: 'image' | 'audio' | 'document';
  buffer: Buffer;
  mime: string;
  originalFileName: string | null;
}

/** Validates every uploaded file's real, sniffable type where one exists (images), and the allow-list otherwise. Never trusts the client-declared type alone for images. */
function prepareAttachments(files: Express.Multer.File[]): PreparedAttachment[] {
  return files.map((file) => {
    const declaredKind = classifyAttachmentMime(file.mimetype);
    if (declaredKind === 'image') {
      const sniffed = detectImageMimeType(file.buffer);
      if (sniffed !== 'image/png' && sniffed !== 'image/jpeg' && sniffed !== 'image/webp') {
        throw new AppError('VALIDATION_ERROR', 'One of the attached images has an unsupported or unreadable format.', undefined, 400);
      }
      return { kind: 'image', buffer: file.buffer, mime: sniffed, originalFileName: file.originalname || null };
    }
    if (declaredKind === 'audio') return { kind: 'audio', buffer: file.buffer, mime: file.mimetype, originalFileName: file.originalname || null };
    if (declaredKind === 'document') return { kind: 'document', buffer: file.buffer, mime: file.mimetype, originalFileName: file.originalname || null };
    throw new AppError('VALIDATION_ERROR', `Unsupported attachment type: ${file.mimetype || 'unknown'}.`, undefined, 400);
  });
}

/** Text used to represent one stored message inside the model's conversation history — attachments never replay their bytes, only a short, honest summary of what they were (plus any audio transcript, already folded into the message's own text at send time). */
function historyTextFor(m: MessageRecord): string {
  const parts: string[] = [];
  if (m.content) parts.push(m.content);
  const imageCount = m.attachments.filter((a) => a.kind === 'image').length;
  if (imageCount > 0) parts.push(`[${imageCount} image${imageCount > 1 ? 's' : ''} attached — not resent]`);
  if (parts.length === 0) return '(empty message)';
  return parts.join('\n');
}

async function attachmentToDto(a: StoredAttachment, storage: ArchitectChatFileStorage): Promise<ArchitectChatAttachmentDTO> {
  const url = await storage.signedUrl(a.path, a.originalFileName ?? undefined).catch(() => null);
  return { kind: a.kind, url, originalFileName: a.originalFileName, transcript: a.transcript };
}

async function messageToDto(m: MessageRecord, storage: ArchitectChatFileStorage): Promise<ArchitectChatMessageDTO> {
  const attachments = await Promise.all(m.attachments.map((a) => attachmentToDto(a, storage)));
  return { id: m.id, role: m.role, content: m.content, attachments, status: m.status, errorCode: (m.errorCode as ErrorCode | null) ?? null, errorMessage: m.errorMessage, createdAt: m.createdAt };
}

function conversationToSummaryDto(c: ConversationRecord): ArchitectChatConversationSummaryDTO {
  return { id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt };
}

// --- Config (public — no auth, no secrets) ------------------------------------

architectChatRouter.get('/architect-chat/config', async (_req: Request, res: Response) => {
  const available = await isArchitectChatAvailable();
  const payload: ArchitectChatConfigResponse = { available, costCredits: ARCHITECT_CHAT_COST_CREDITS };
  res.json(payload);
});

// --- Local dev fallback file serving (mirrors generateHumanizedFloorplanSimple's) ---

architectChatRouter.get('/architect-chat/file', async (req: Request, res: Response) => {
  try {
    const storage = await getArchitectChatFileStorage().catch(() => null);
    if (!storage || storage.backend !== 'local') {
      res.status(404).json({ error: { code: 'UNKNOWN_ERROR', message: 'Not found.' } });
      return;
    }
    const claims = verifyFileToken(typeof req.query.token === 'string' ? req.query.token : '');
    if (!claims) {
      res.status(403).json({ error: { code: 'UNAUTHENTICATED', message: 'This link is invalid or has expired.' } });
      return;
    }
    const buffer = await storage.read(claims.path);
    if (!buffer) {
      res.status(404).json({ error: { code: 'UNKNOWN_ERROR', message: 'The file is no longer available.' } });
      return;
    }
    res.setHeader('Content-Type', contentTypeForPath(claims.path));
    res.setHeader('Cache-Control', 'private, max-age=300');
    if (claims.name) res.setHeader('Content-Disposition', `inline; filename="${claims.name.replace(/[^\w.\-]+/g, '_')}"`);
    res.send(buffer);
  } catch (err) {
    sendError(res, err);
  }
});

// --- Conversations -------------------------------------------------------------

architectChatRouter.get('/architect-chat/conversations', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const store = await getArchitectChatStore();
    const limit = Math.min(ARCHITECT_CHAT_HISTORY_MAX_LIMIT, Math.max(1, Number(req.query.limit) || ARCHITECT_CHAT_HISTORY_DEFAULT_LIMIT));
    const conversations = await store.listConversations(req.user!.id, limit);
    res.json({ conversations: conversations.map(conversationToSummaryDto) });
  } catch (err) {
    sendError(res, err);
  }
});

architectChatRouter.get('/architect-chat/conversations/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const store = await getArchitectChatStore();
    const storage = await getArchitectChatFileStorage();
    const conversation = await store.getConversation(req.user!.id, req.params.id);
    if (!conversation) {
      res.status(404).json({ error: { code: 'UNKNOWN_ERROR', message: 'Conversation not found.' } });
      return;
    }
    const messages = await store.listMessages(req.user!.id, conversation.id, ARCHITECT_CHAT_MESSAGES_PAGE_LIMIT);
    const dto: ArchitectChatConversationDetailDTO = { ...conversationToSummaryDto(conversation), messages: await Promise.all(messages.map((m) => messageToDto(m, storage))) };
    res.json(dto);
  } catch (err) {
    sendError(res, err);
  }
});

architectChatRouter.delete('/architect-chat/conversations/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const store = await getArchitectChatStore();
    const storage = await getArchitectChatFileStorage();
    const deleted = await store.softDeleteConversation(req.user!.id, req.params.id);
    if (!deleted) {
      res.status(404).json({ error: { code: 'UNKNOWN_ERROR', message: 'Conversation not found.' } });
      return;
    }
    await storage.removeConversation(req.user!.id, req.params.id).catch((err) => serverLogger.error(`Could not remove attachment files for conversation ${req.params.id}`, err instanceof Error ? err.message : String(err)));
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

// --- Send a message --------------------------------------------------------------

architectChatRouter.post('/architect-chat/conversations/:id/messages', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;

  try {
    await runUpload(req, res);
  } catch (err) {
    sendError(res, err);
    return;
  }

  let store: ArchitectChatStore;
  let storage: ArchitectChatFileStorage;
  try {
    if (!isArchitectChatFlagEnabled()) throw new AppError('VALIDATION_ERROR', 'Arquiteto Estagiário is not available yet.', undefined, 400);
    store = await getArchitectChatStore();
    storage = await getArchitectChatFileStorage();
  } catch (err) {
    serverLogger.error('Architect chat infrastructure unavailable', err instanceof Error ? err.message : String(err));
    sendError(res, err instanceof AppError ? err : new AppError('PROVIDER_UNAVAILABLE', 'The assistant is temporarily unavailable.', undefined, 503));
    return;
  }

  const isNewConversation = req.params.id === NEW_CONVERSATION_SENTINEL;
  let conversation: ConversationRecord | null = null;
  if (!isNewConversation) {
    conversation = await store.getConversation(userId, req.params.id);
    if (!conversation) {
      res.status(404).json({ error: { code: 'UNKNOWN_ERROR', message: 'Conversation not found.' } });
      return;
    }
  }

  const rawText = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  const text = rawText.slice(0, ARCHITECT_CHAT_MAX_MESSAGE_CHARS);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];

  let attachments: PreparedAttachment[];
  try {
    attachments = prepareAttachments(files);
  } catch (err) {
    sendError(res, err);
    return;
  }
  if (!text && attachments.length === 0) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Write a message or attach a photo/audio file.' } });
    return;
  }

  const conversationId = conversation?.id ?? crypto.randomUUID();
  const userMessageId = crypto.randomUUID();
  const idempotencyKey = typeof req.body.idempotencyKey === 'string' && req.body.idempotencyKey.trim() ? req.body.idempotencyKey.trim().slice(0, 100) : null;

  // 1) Reserve credits FIRST — nothing is created or persisted for a refused request.
  let reservation: ActiveReservation;
  try {
    reservation = await reserveCredits({ userId, amount: ARCHITECT_CHAT_COST_CREDITS, tool: TOOL, generationId: userMessageId, idempotencyKey });
  } catch (err) {
    sendError(res, err);
    return;
  }

  // From here on, ANY failure must refund. SSE headers are sent once we are past validation/reservation.
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (event: Record<string, unknown>) => {
    if (res.writableEnded || res.destroyed) return;
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      // The client is gone — nothing left to do; the pipeline below still finishes so credits settle correctly.
    }
  };
  const finish = () => {
    if (!res.writableEnded) res.end();
  };

  try {
    const now = new Date().toISOString();

    // 2) Save attachments and transcribe any audio. A failure here is technical: nothing is delivered yet
    // (the conversation row itself is only created further down, once this has succeeded), so refund and stop.
    const storedAttachments: StoredAttachment[] = [];
    const currentImages: ChatImagePart[] = [];
    let audioTranscriptBlock = '';
    let documentBlock = '';
    for (let i = 0; i < attachments.length; i++) {
      const a = attachments[i];
      const path = await storage.save(userId, conversationId, userMessageId, i, a.buffer, a.mime);
      if (a.kind === 'image') {
        currentImages.push({ buffer: a.buffer, mime: a.mime as ChatImagePart['mime'] });
        storedAttachments.push({ kind: 'image', path, mime: a.mime, originalFileName: a.originalFileName, transcript: null });
      } else if (a.kind === 'audio') {
        const { text: transcript } = await transcribeAudio(a.buffer, a.mime, a.originalFileName || `audio-${i}.webm`);
        audioTranscriptBlock += `\n\n[Audio attachment${a.originalFileName ? ` "${a.originalFileName}"` : ''} transcript]: ${transcript || '(silence or no speech detected)'}`;
        storedAttachments.push({ kind: 'audio', path, mime: a.mime, originalFileName: a.originalFileName, transcript: transcript || null });
      } else {
        const decoded = a.buffer.toString('utf8').slice(0, ARCHITECT_CHAT_MAX_DOCUMENT_CHARS);
        documentBlock += `\n\n[Attached text file${a.originalFileName ? ` "${a.originalFileName}"` : ''}]:\n${decoded}`;
        storedAttachments.push({ kind: 'document', path, mime: a.mime, originalFileName: a.originalFileName, transcript: null });
      }
    }

    const currentText = `${text}${audioTranscriptBlock}${documentBlock}`.trim();

    // 3) Everything needed to deliver the turn is in hand: create the conversation row (if new) and the
    // user's own message together — from here on the turn is safe to persist even if the model call below fails.
    if (isNewConversation) {
      conversation = { id: conversationId, userId, title: deriveTitle(text), createdAt: now, updatedAt: now, deletedAt: null };
      await store.createConversation(conversation);
    }
    const userMessage: MessageRecord = {
      id: userMessageId,
      conversationId,
      userId,
      role: 'user',
      content: text,
      attachments: storedAttachments,
      status: 'completed',
      errorCode: null,
      errorMessage: null,
      creditsCharged: 0,
      reservationId: null,
      captureTransactionId: null,
      refundTransactionId: null,
      model: null,
      requestId: null,
      usage: null,
      costUsd: null,
      createdAt: now,
    };
    const priorMessages = await store.listMessages(userId, conversationId, ARCHITECT_CHAT_MAX_HISTORY_MESSAGES);
    await store.insertMessage(userMessage);
    await store.touchConversation(userId, conversationId, { updatedAt: new Date().toISOString() });

    send({ type: 'start', conversationId, userMessageId, title: conversation?.title ?? '' });

    const history: ChatHistoryTurn[] = priorMessages.slice(-ARCHITECT_CHAT_MAX_HISTORY_MESSAGES).map((m) => ({ role: m.role, content: historyTextFor(m) }));

    // 5) The assistant's turn. Failure here refunds; the user's message above is kept either way.
    const assistantMessageId = crypto.randomUUID();
    try {
      const result = await streamChatReply({ history, currentText, currentImages, onDelta: (chunk) => send({ type: 'delta', text: chunk }) });
      const usage: ArchitectMessageUsage | null = result.usage;
      const captured = await captureCredits(reservation);
      const assistantMessage: MessageRecord = {
        id: assistantMessageId,
        conversationId,
        userId,
        role: 'assistant',
        content: result.text,
        attachments: [],
        status: 'completed',
        errorCode: null,
        errorMessage: null,
        creditsCharged: captured.captured,
        reservationId: reservation.id,
        captureTransactionId: captured.captureId,
        refundTransactionId: captured.refundId,
        model: OPENAI_ARCHITECT_CHAT_MODEL,
        requestId: result.requestId,
        usage,
        costUsd: estimateArchitectChatCostUsd(usage),
        createdAt: new Date().toISOString(),
      };
      await store.insertMessage(assistantMessage);
      await store.touchConversation(userId, conversationId, { updatedAt: assistantMessage.createdAt });
      send({ type: 'done', conversationId, assistantMessageId, title: conversation?.title ?? '' });
    } catch (err) {
      const failure = sanitizedFailure(err);
      const refunded = await refundCredits(reservation, failure.code.toLowerCase());
      const assistantMessage: MessageRecord = {
        id: assistantMessageId,
        conversationId,
        userId,
        role: 'assistant',
        content: '',
        attachments: [],
        status: 'failed',
        errorCode: failure.code,
        errorMessage: failure.message,
        creditsCharged: 0,
        reservationId: reservation.id,
        captureTransactionId: null,
        refundTransactionId: refunded?.refundId ?? null,
        model: OPENAI_ARCHITECT_CHAT_MODEL,
        requestId: null,
        usage: null,
        costUsd: null,
        createdAt: new Date().toISOString(),
      };
      await store.insertMessage(assistantMessage).catch((storeErr) => serverLogger.error(`Could not record failed assistant message ${assistantMessageId}`, storeErr instanceof Error ? storeErr.message : String(storeErr)));
      if (err instanceof AppError) serverLogger.error(`Architect chat reply ${assistantMessageId} failed`, { code: err.code });
      else serverLogger.error(`Architect chat reply ${assistantMessageId} failed unexpectedly`, err instanceof Error ? err.message : String(err));
      send({ type: 'error', code: failure.code, message: failure.message, conversationId, assistantMessageId });
    }
  } catch (err) {
    // A failure before the user's message was even persisted (attachment storage/transcription): refund fully, nothing to show.
    await refundCredits(reservation, 'technical_error');
    if (err instanceof AppError) serverLogger.error('Architect chat message could not be received', { code: err.code });
    else serverLogger.error('Architect chat message could not be received', err instanceof Error ? err.message : String(err));
    const failure = sanitizedFailure(err);
    send({ type: 'error', code: failure.code, message: failure.message, conversationId });
  } finally {
    finish();
  }
});
