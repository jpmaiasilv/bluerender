import { ErrorCode } from './api';

export type ArchitectMessageRoleDTO = 'user' | 'assistant';

export interface ArchitectChatConfigResponse {
  available: boolean;
  costCredits: number;
}

export interface ArchitectChatAttachmentDTO {
  kind: 'image' | 'audio' | 'document';
  url: string | null;
  originalFileName: string | null;
  /** Only present for kind 'audio' — what the assistant actually understood from it. */
  transcript: string | null;
}

export interface ArchitectChatMessageDTO {
  id: string;
  role: ArchitectMessageRoleDTO;
  content: string;
  attachments: ArchitectChatAttachmentDTO[];
  status: 'completed' | 'failed';
  errorCode: ErrorCode | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface ArchitectChatConversationSummaryDTO {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArchitectChatConversationDetailDTO extends ArchitectChatConversationSummaryDTO {
  messages: ArchitectChatMessageDTO[];
}
