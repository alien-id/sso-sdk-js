# @alien-id/sso-react

## 2.1.0-beta.0

### Minor Changes

- [#60](https://github.com/alien-id/sso-sdk-js/pull/60) [`7df8304`](https://github.com/alien-id/sso-sdk-js/commit/7df83048f0e18eee1e3991083936fbd74fd834a8) Thanks [@truehazker-eti](https://github.com/truehazker-eti)! - Add `SignInPanel`, the Alien sign-in flow (QR / agent / success / error) rendered inline without a modal shell. `SignInModal` now reuses it, so both paths share one implementation.

  Harden the single-use authorization-code exchange against duplicate sends across every react-query re-run vector — focus, reconnect, mount/remount, error-state retry, and `enabled` toggling — and stop the poll query from re-firing a consumed code on remount.

## 2.0.1

### Patch Changes

- [#28](https://github.com/alien-id/sso-sdk-js/pull/28) [`5bb6ee2`](https://github.com/alien-id/sso-sdk-js/commit/5bb6ee2b61b758121b922cef9dbd539880dc7937) Thanks [@truehazker-eti](https://github.com/truehazker-eti)! - Fix QR code stuck on the loading spinner forever when more than one `SignInModal` is mounted (e.g. a consumer renders `<SignInModal />` manually on top of the one the provider auto-renders).

  All modal instances observe the same query keys on the shared module-level `QueryClient`, so react-query deduplicates the deeplink fetch and runs only one instance's `queryFn`. The modal previously populated its state (`deeplink`, `pollingCode`, `isLoadingQr`, errors, success) via side effects inside that `queryFn` closure — every other instance, including the visible top-most one, never left the loading state even though the request and polling succeeded.
  - Modal state is now derived from query results (the shared cache), so every observer renders correctly no matter whose `queryFn` performed the fetch. The token exchange runs as a query too, deduplicating the single-use authorization-code exchange across instances.
  - The provider now hands out a modal slot: duplicate `SignInModal` instances render nothing, so overlays no longer stack (this also un-shadows the close button).
  - The deeplink query key is scoped by SSO base URL + provider address so two providers with different configs don't serve each other's deeplink.
