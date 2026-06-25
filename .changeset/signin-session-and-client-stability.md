---
"@alien-id/sso-react": patch
---

Fix two sign-in robustness issues:

- **No false "success" without a session.** `exchangeToken` now rejects when the token exchange resolves but produces no usable session (e.g. a missing or unverifiable `id_token`, so `getAuthData()` is null). Previously the panel showed "Sign in successful!" off the raw token response while `auth.isAuthenticated` stayed false — the success screen and auth state could disagree. They now always agree: a session, or an error screen.
- **Stable client across inline `config` literals.** `AlienSsoProvider` memoizes the `AlienSsoClient` on config *values* instead of the config object's identity. Passing an inline `config={{...}}` (the pattern in our docs) no longer rebuilds the client — and tears down the auth context — on every parent re-render.
