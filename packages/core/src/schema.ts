import { z } from 'zod/v4-mini';

/**
 * Internal Authorize request/response schema to server SDK
 */
export const InternalAuthorizeRequestSchema = z.object({
  code_challenge: z.string(),
});
export type InternalAuthorizeRequest = z.infer<
  typeof InternalAuthorizeRequestSchema
>;

/**
 * Authorize request/response schema
 */
export const AuthorizeRequestSchema = z.object({
  code_challenge: z.string(),
  code_challenge_method: z.literal('S256'),
  provider_address: z.string(),
  provider_signature: z.string(),
});
export type AuthorizeRequest = z.infer<typeof AuthorizeRequestSchema>;

export const AuthorizeResponseSchema = z.object({
  deep_link: z.string(),
  polling_code: z.string(),
  expired_at: z.number(),
});

export type AuthorizeResponse = z.infer<typeof AuthorizeResponseSchema>;

/**
 * Poll request/response schema
 */
export const PollRequestSchema = z.object({
  polling_code: z.string(),
});

export type PollRequest = z.infer<typeof PollRequestSchema>;

const status = ['pending', 'authorized'] as const;
const StatusEnum = z.enum(status);
type StatusEnum = z.infer<typeof StatusEnum>;

export const PollResponseSchema = z.object({
  status: StatusEnum,
  authorization_code: z.optional(z.string()),
});

export type PollResponse = z.infer<typeof PollResponseSchema>;

/**
 * ExchangeCode request/response schema
 */
export const ExchangeCodeRequestSchema = z.object({
  authorization_code: z.string(),
  code_verifier: z.string(),
});
export type ExchangeCodeRequest = z.infer<typeof ExchangeCodeRequestSchema>;

export const ExchangeCodeResponseSchema = z.object({
  access_token: z.string(),
});

export type ExchangeCodeResponse = z.infer<typeof ExchangeCodeResponseSchema>;

/**
 * VerifyToken request/response schema
 */
export const VerifyTokenRequestSchema = z.object({
  access_token: z.string(),
});
export type VerifyTokenRequest = z.infer<typeof VerifyTokenRequestSchema>;

export const VerifyTokenResponseSchema = z.object({
  is_valid: z.boolean(),
});

export type VerifyTokenResponse = z.infer<typeof VerifyTokenResponseSchema>;

/**
 * User info schema
 */
export const UserInfoSchema = z.object({
  session_address: z.string(),
});
export type UserInfo = z.infer<typeof UserInfoSchema>;

/**
 * Token info schema
 */
export const TokenInfoSchema = z.object({
  app_callback_payload: z.string(),
  app_callback_session_signature: z.string(),
  app_callback_session_address: z.string(),
  expired_at: z.number(),
  issued_at: z.number(),
});
export type TokenInfo = z.infer<typeof TokenInfoSchema>;
