import { z } from "zod/v4-mini";

export const AlienSSOConfigSchema = z.object({
    providerAddress: z.string(),
    providerPrivateKey: z.string(),
    baseUrl: z.url({ protocol: /^https$/ }),
    pollingInterval: z.optional(z.number()),
});

export type AlienSSOConfig = z.infer<typeof AlienSSOConfigSchema>;

/**
 * Authorize request/response schema
 */
export const AuthorizeRequestSchema = z.object({
    code_challenge: z.string(),
    code_challenge_method: 'S256',
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

const status = ["pending", "authorized"] as const;
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
