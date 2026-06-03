---
'@alien-id/sso-react': patch
---

Fix QR code stuck on the loading spinner forever when more than one `SignInModal` is mounted (e.g. a consumer renders `<SignInModal />` manually on top of the one the provider auto-renders).

All modal instances observe the same query keys on the shared module-level `QueryClient`, so react-query deduplicates the deeplink fetch and runs only one instance's `queryFn`. The modal previously populated its state (`deeplink`, `pollingCode`, `isLoadingQr`, errors, success) via side effects inside that `queryFn` closure — every other instance, including the visible top-most one, never left the loading state even though the request and polling succeeded.

- Modal state is now derived from query results (the shared cache), so every observer renders correctly no matter whose `queryFn` performed the fetch. The token exchange runs as a query too, deduplicating the single-use authorization-code exchange across instances.
- The provider now hands out a modal slot: duplicate `SignInModal` instances render nothing, so overlays no longer stack (this also un-shadows the close button).
- The deeplink query key is scoped by SSO base URL + provider address so two providers with different configs don't serve each other's deeplink.
