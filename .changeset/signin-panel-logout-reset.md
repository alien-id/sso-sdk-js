---
"@alien-id/sso-react": minor
---

Fix the inline `SignInPanel` getting stuck on the success screen after `logout()`. `logout()` now resets the sign-in flow cache (`auth-deeplink` / `auth-poll` / `auth-exchange`), so a signed-out user returns to a fresh QR instead of re-deriving success from the stale, infinitely-cached exchange result.

Model the flow as an explicit state machine — `loading` / `awaiting` / `success` / `error` — and surface the current `status` (plus a `SignInStatus` type) to the `wrap` callback, so inline consumers can lay out surrounding chrome (centre the terminal screens, hide content once the flow leaves `awaiting`).

Add a `gap` to the QR footer so the Download button no longer crowds the "Don't have an Alien App yet?" text.
