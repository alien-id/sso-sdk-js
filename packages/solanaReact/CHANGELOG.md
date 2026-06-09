# @alien-id/sso-solana-react

## 2.1.0

### Minor Changes

- [#40](https://github.com/alien-id/sso-sdk-js/pull/40) [`469d14b`](https://github.com/alien-id/sso-sdk-js/commit/469d14b2acdb6fbc8f60b3f20f506978cbea0f51) Thanks [@alekseiEti](https://github.com/alekseiEti)! - Add optional `walletName` argument to `generateDeeplink`. When provided, it is sent as `wallet_name` in `POST /solana/link` and embedded in the signed deeplink so the Alien app can display the source wallet (e.g. phantom, solflare). Backward compatible — omitting it behaves as before.

### Patch Changes

- Updated dependencies [[`469d14b`](https://github.com/alien-id/sso-sdk-js/commit/469d14b2acdb6fbc8f60b3f20f506978cbea0f51)]:
  - @alien-id/sso-solana@2.1.0
