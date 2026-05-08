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
  // RFC 6749 §10.12: when the client sent `state` on /authorize, the AS
  // MUST echo it back on the auth response so the client can verify the
  // round-trip. Optional because not every deployment echoes state through
  // the poll endpoint.
  state: z.optional(z.string()),
  // RFC 9207 §2: when the AS advertises
  // `authorization_response_iss_parameter_supported: true`, it MUST
  // include `iss` on every authorization response so the client can
  // detect mix-up attacks where one AS redirects/relays the response of
  // another. Optional at the schema level — when present, the client
  // MUST verify it equals the expected issuer (see `pollAuth`).
  iss: z.optional(z.string()),
});

export type PollResponse = z.infer<typeof PollResponseSchema>;

/**
 * Token exchange response schema (OAuth2 standard)
 * POST /oauth/token
 *
 * RFC 6749 §6: refresh_token reissuance is OPTIONAL on a refresh
 * response — "the authorization server MAY issue a new refresh token, in
 * which case the client MUST discard the old refresh token". We therefore
 * mark it optional at the schema level and preserve the old refresh_token
 * in storage when the response omits one (see `client.persistTokens`).
 */
export const TokenResponseSchema = z.object({
  access_token: z.string(),
  // Validated case-insensitively against `bearer` in `assertBearerTokenType`
  // before tokens are persisted (RFC 6750 §4 / RFC 9449 §5). The schema
  // keeps it as a plain string so a non-Bearer response still parses to a
  // typed surface that the caller can inspect for diagnostics.
  token_type: z.string(),
  expires_in: z.number(),
  id_token: z.optional(z.string()),
  refresh_token: z.optional(z.string()),
});

/**
 * RFC 6750 §4 / RFC 9449 §5: this client sends only Bearer requests, so a
 * `token_type=DPoP` would mean the AT is sender-constrained to a key we
 * did not present — using it as Bearer would be rejected by the resource
 * server. Reject up-front rather than silently downgrade. Comparison is
 * case-insensitive per RFC 6750 §1.1.
 */
export function assertBearerTokenType(tokenType: string): void {
  if (tokenType.toLowerCase() !== 'bearer') {
    throw new Error(
      `token_type must be Bearer (RFC 6750 §4); got ${tokenType}. ` +
        'DPoP-bound tokens are not supported by this client.',
    );
  }
}

/**
 * RFC 9449 §5: when the client requested DPoP-bound issuance (sent a
 * `dpop_jkt` on /authorize and a DPoP proof on /token), the AS MUST return
 * `token_type=DPoP`. A `Bearer` response means the AS did not honor the
 * binding, so the access token is NOT bound to our key — using it would
 * be a silent downgrade. Reject case-insensitively.
 */
export function assertDPoPTokenType(tokenType: string): void {
  if (tokenType.toLowerCase() !== 'dpop') {
    throw new Error(
      `token_type must be DPoP (RFC 9449 §5); got ${tokenType}. ` +
        'AS returned a non-DPoP-bound token despite a DPoP proof — refusing to silently downgrade.',
    );
  }
}

export type TokenResponse = z.infer<typeof TokenResponseSchema>;

/**
 * UserInfo response schema
 * GET /oauth/userinfo
 */
export const UserInfoResponseSchema = z.object({
  sub: z.string(),
  // `/oauth/userinfo` returns the AT's client_id here so RP-side
  // consumers can confirm the token was issued for them.
  aud: z.optional(z.string()),
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
  // RFC 7519 §4.1.6: `iat` is OPTIONAL. Some legitimate id_tokens omit it.
  iat: z.optional(z.number()),
  // RFC 9068 §2.2: REQUIRED on AT, absent on id_token — optional here so
  // both shapes parse.
  client_id: z.optional(z.string()),
  jti: z.optional(z.string()),
  nonce: z.optional(z.string()),
  auth_time: z.optional(z.number()),
  // OIDC §3.1.3.7.6/.7: when present, MUST equal the consumer's client_id.
  azp: z.optional(z.string()),
});
export type TokenInfo = z.infer<typeof TokenInfoSchema>;

// Legacy exports for backward compatibility during transition
export const ExchangeCodeResponseSchema = TokenResponseSchema;
export type ExchangeCodeResponse = TokenResponse;
