import { z } from 'zod/v4-mini';

/**
 * Authorize response schema (for response_mode=json)
 * GET /oauth/authorize?response_mode=json&...
 */
export const AuthorizeResponseSchema = z.object({
  deep_link: z.string(),
  polling_code: z.string(),
  expired_at: z.number(),
});

export type AuthorizeResponse = z.infer<typeof AuthorizeResponseSchema>;

/**
 * Poll request/response schema
 * POST /oauth/poll
 */
export const PollRequestSchema = z.object({
  polling_code: z.string(),
});

export type PollRequest = z.infer<typeof PollRequestSchema>;

const status = ['pending', 'authorized', 'rejected', 'expired'] as const;
const StatusEnum = z.enum(status);
type StatusEnum = z.infer<typeof StatusEnum>;

export const PollResponseSchema = z.object({
  status: StatusEnum,
  authorization_code: z.optional(z.string()),
});

export type PollResponse = z.infer<typeof PollResponseSchema>;

/**
 * Token exchange response schema (OAuth2 standard)
 * POST /oauth/token
 */
export const TokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  id_token: z.string(),
  refresh_token: z.string(),
});

export type TokenResponse = z.infer<typeof TokenResponseSchema>;

/**
 * UserInfo response schema
 * GET /oauth/userinfo
 */
export const UserInfoResponseSchema = z.object({
  sub: z.string(),
});

export type UserInfoResponse = z.infer<typeof UserInfoResponseSchema>;

/**
 * Token info schema (parsed from JWT)
 * Standard OIDC claims
 */
export const TokenInfoSchema = z.object({
  iss: z.string(),
  sub: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number(),
  iat: z.number(),
  nonce: z.optional(z.string()),
  auth_time: z.optional(z.number()),
});
export type TokenInfo = z.infer<typeof TokenInfoSchema>;

// Legacy exports for backward compatibility during transition
export const ExchangeCodeResponseSchema = TokenResponseSchema;
export type ExchangeCodeResponse = TokenResponse;
