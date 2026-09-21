import { HUMANIZED_FLOORPLAN_WALLET_DEBIT_CREDITS } from './humanizedFloorplanEngine';

/**
 * Billing RULES for the enhanced Planta Humanizada flow (mask review +
 * OpenAI furniture recognition + block placement + FLUX.1 Fill
 * humanization) — structural constants only. Nothing in this round wires
 * these into an actual paid route: the existing, already-shipped
 * HUMANIZED_FLOORPLAN_WALLET_DEBIT_CREDITS (8 credits — see
 * config/humanizedFloorplanEngine.ts) remains exactly what
 * routes/generateHumanizedFloorplan.ts actually charges today and is left
 * untouched. These are the agreed values for when the fuller flow
 * (recognition + block library + humanization together) is actually built
 * and billed.
 */

/** Full Planta Humanizada flow (structural mask + furniture recognition/placement + final FLUX.1 Fill humanization), once that whole flow is wired into one billable action. */
export const PLANTA_HUMANIZADA_FULL_WALLET_DEBIT_CREDITS = HUMANIZED_FLOORPLAN_WALLET_DEBIT_CREDITS;

/** Generating ONE new furniture block with AI (OpenAI image generation — see providers/openaiBlockImage.ts). Charged once per successfully validated block, never per attempt. */
export const BLOCK_CREATE_WALLET_DEBIT_CREDITS = 2;

/** Placing an EXISTING block (from the user's library or a shared default library) onto a plan — always free. */
export const BLOCK_REUSE_WALLET_DEBIT_CREDITS = 0;

/** Moving, rotating, resizing, or deleting a block already placed on a plan — always free (pure client-side/editor operations, no provider call). */
export const BLOCK_TRANSFORM_WALLET_DEBIT_CREDITS = 0;

/**
 * Structural billing rules this whole flow must respect (enforced by
 * whichever route eventually implements it, not by these constants
 * themselves — documented here as the single source of truth for what
 * "correct" means):
 *
 * 1. A technical failure (provider error, timeout, network failure) is
 *    NEVER charged.
 * 2. An automatic rejection — failed transparency validation, failed PNG
 *    validation, failed structural-mask validation — is NEVER charged.
 * 3. debit() happens EXACTLY ONCE, only after the result has been
 *    validated and is ready to deliver — never optimistically before that.
 * 4. Polling a job's status (GET .../:jobId) NEVER triggers a new provider
 *    call and NEVER triggers a new charge — it only ever reads already-set
 *    job state.
 * 5. Every paid operation is submitted with an idempotency key (see
 *    services/idempotencyKeys.ts) — retrying the SAME logical request
 *    (e.g. a client retry after a dropped response) must never charge
 *    twice for the same operation.
 */
