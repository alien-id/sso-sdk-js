# @alien-id/sso-solana

## 2.2.1

### Patch Changes

- [`440abcf`](https://github.com/alien-id/sso-sdk-js/commit/440abcf19af2dcb3e52450a9d227681539a49ff9) Thanks [@truehazker-eti](https://github.com/truehazker-eti)! - Rebuild and republish under the refreshed build toolchain — Node 24.17.0 and `@types/node` 24.13.2. No source or public API changes.

## 2.2.1-beta.0

### Patch Changes

- [`440abcf`](https://github.com/alien-id/sso-sdk-js/commit/440abcf19af2dcb3e52450a9d227681539a49ff9) Thanks [@truehazker-eti](https://github.com/truehazker-eti)! - Rebuild and republish under the refreshed build toolchain — Node 24.17.0 and `@types/node` 24.13.2. No source or public API changes.

## 2.2.0

### Minor Changes

- [#42](https://github.com/alien-id/sso-sdk-js/pull/42) [`d7a3a43`](https://github.com/alien-id/sso-sdk-js/commit/d7a3a4360d905129dbf6beaeed3c72658a9a950c) Thanks [@alekseiEti](https://github.com/alekseiEti)! - Add optional `walletIcon` argument to `generateDeeplink`. When provided, it is sent as `wallet_icon` in `POST /solana/link` and embedded in the signed deeplink so the Alien app can display the source wallet's icon. Backward compatible — omitting it behaves as before.

## 2.1.0

### Minor Changes

- [#40](https://github.com/alien-id/sso-sdk-js/pull/40) [`469d14b`](https://github.com/alien-id/sso-sdk-js/commit/469d14b2acdb6fbc8f60b3f20f506978cbea0f51) Thanks [@alekseiEti](https://github.com/alekseiEti)! - Add optional `walletName` argument to `generateDeeplink`. When provided, it is sent as `wallet_name` in `POST /solana/link` and embedded in the signed deeplink so the Alien app can display the source wallet (e.g. phantom, solflare). Backward compatible — omitting it behaves as before.
