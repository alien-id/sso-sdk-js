import { z } from 'zod/v4-mini';

/**
 * Solana Link request/response schema
 */
export const SolanaLinkRequestSchema = z.object({
  solana_address: z.string(),
});
export type SolanaLinkRequest = z.infer<typeof SolanaLinkRequestSchema>;

export const SolanaLinkResponseSchema = z.object({
  deep_link: z.string(),
  polling_code: z.string(),
  expired_at: z.number(),
});
export type SolanaLinkResponse = z.infer<typeof SolanaLinkResponseSchema>;

/**
 * Solana Poll request/response schema
 */
export const SolanaPollRequestSchema = z.object({
  polling_code: z.string(),
});
export type SolanaPollRequest = z.infer<typeof SolanaPollRequestSchema>;

const solanaStatus = ['pending', 'authorized', 'rejected'] as const;
const SolanaStatusEnum = z.enum(solanaStatus);
type SolanaStatusEnum = z.infer<typeof SolanaStatusEnum>;

export const SolanaPollResponseSchema = z.object({
  status: SolanaStatusEnum,
  oracle_signature: z.optional(z.string()),
  oracle_public_key: z.optional(z.string()),
  solana_address: z.optional(z.string()),
  timestamp: z.optional(z.number()),
  session_address: z.optional(z.string()),
});
export type SolanaPollResponse = z.infer<typeof SolanaPollResponseSchema>;

/**
 * Solana Attestation request/response schema
 */
export const SolanaAttestationRequestSchema = z.object({
  solana_address: z.string(),
});
export type SolanaAttestationRequest = z.infer<
  typeof SolanaAttestationRequestSchema
>;

export const SolanaAttestationResponseSchema = z.object({
  session_address: z.string(),
});
export type SolanaAttestationResponse = z.infer<
  typeof SolanaAttestationResponseSchema
>;
