---
"@alien-id/sso-react": minor
---

Add `SignInPanel`, the Alien sign-in flow (QR / agent / success / error) rendered inline without a modal shell. `SignInModal` now reuses it, so both paths share one implementation.

Harden the single-use authorization-code exchange against duplicate sends across every react-query re-run vector — focus, reconnect, mount/remount, error-state retry, and `enabled` toggling — and stop the poll query from re-firing a consumed code on remount.
