/**
 * Types for the furniture "block" library (AI-generated or user-provided
 * PNG cutouts placed into a humanized floor plan) — persistence types and
 * repository CONTRACT only in this round. Per explicit requirement, this
 * must not become a solution that depends on local/temporary file storage
 * for production: no in-memory or local-filesystem BlockLibraryRepository
 * implementation is provided here. A real implementation (e.g. backed by
 * the same Supabase project already used for auth/other persisted data —
 * see src/lib/supabase* elsewhere in this codebase) is a follow-up, once
 * the block-image generation call itself is authorized and implemented for
 * real. Nothing here is wired into any route yet.
 */

export type BlockStatus = 'pending' | 'ready' | 'rejected' | 'failed';

export interface FurnitureBlock {
  id: string;
  userId: string;
  category: string;
  name: string;
  originalPrompt: string;
  model: string;
  /** Real-world approximate dimensions, in meters — optional, filled in when known (e.g. user-specified or inferred), never required to have a block. */
  widthMeters: number | null;
  depthMeters: number | null;
  pngUrl: string;
  thumbnailUrl: string | null;
  /** Result of validateBlockImagePng (see openaiBlockImage.ts) — a block is never marked "ready" with this false. */
  transparencyValidated: boolean;
  createdAt: string;
  /** Real provider cost, informational only — never what the user is billed. */
  providerCostUsd: number | null;
  /** What was actually debited from the user's wallet for this block — see config/humanizedFloorplanBilling.ts. Always BLOCK_CREATE_WALLET_DEBIT_CREDITS for an AI-generated block, 0 for anything else that can produce a FurnitureBlock row (e.g. a user upload, if that's ever supported). */
  walletDebitCredits: number;
  status: BlockStatus;
  /** Whether this block can be reused (dragged into another floor plan) for free after creation — per requirement, using an EXISTING block is always free regardless of this flag; this only marks whether the block is considered a finished, shareable library entry vs. a one-off. */
  reusable: boolean;
}

export interface CreateFurnitureBlockInput {
  userId: string;
  category: string;
  name: string;
  originalPrompt: string;
  model: string;
  widthMeters?: number | null;
  depthMeters?: number | null;
  pngUrl: string;
  thumbnailUrl?: string | null;
  transparencyValidated: boolean;
  providerCostUsd: number | null;
  walletDebitCredits: number;
  status: BlockStatus;
  reusable: boolean;
}

/**
 * Repository CONTRACT for block persistence — no concrete implementation in
 * this round. A route handler (once built) depends on this interface, not
 * on any specific storage technology, so swapping in a real backing store
 * later never touches call sites.
 */
export interface BlockLibraryRepository {
  create(input: CreateFurnitureBlockInput): Promise<FurnitureBlock>;
  getById(id: string): Promise<FurnitureBlock | null>;
  listByUser(userId: string, category?: string): Promise<FurnitureBlock[]>;
  updateStatus(id: string, status: BlockStatus): Promise<void>;
  delete(id: string): Promise<void>;
}
