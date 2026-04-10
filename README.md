## ⚠️ Alpha Version Notice

**This is an early alpha version of the Alien SSO SDK.** The SDK is under active development and may contain bugs or undergo breaking changes. Use with caution in production environments.

## Overview

This monorepo provides two authentication approaches:

- **Standard SSO**: Web2-style OIDC authentication with TEE and blockchain backing
- **Solana SSO**: Blockchain-native authentication with on-chain attestations on Solana

## Packages

### Standard SSO

- **[@alien-id/sso](./packages/core)** - Core TypeScript client for OIDC-style authentication
- **[@alien-id/sso-react](./packages/react)** - React hooks and components for Standard SSO

### Solana SSO

- **[@alien-id/sso-solana](./packages/solanaCore)** - Solana-specific authentication client with on-chain attestation support
- **[@alien-id/sso-solana-react](./packages/solanaReact)** - React hooks and components for Solana SSO

### Agent ID

- **[@alien-id/sso-agent-id](./packages/agent-id)** - Verify AI agent identity tokens with full owner chain verification via Alien SSO

## Documentation

📚 **Full documentation available at [docs.alien.org](https://docs.alien.org)**

### Guides

- [Standard SSO Integration Guide](https://docs.alien.org/sso-guide/introduction)
  - [Core Integration](https://docs.alien.org/sso-guide/core-integration) - Vanilla JS/TS
  - [React Integration](https://docs.alien.org/sso-guide/react-integration) - React hooks and components

- [Solana SSO Integration Guide](https://docs.alien.org/solana-sso-guide/introduction)
  - [Core Integration](https://docs.alien.org/solana-sso-guide/core-integration) - Vanilla JS/TS with Solana
  - [React Integration](https://docs.alien.org/solana-sso-guide/react-integration) - React with wallet adapters

### API Reference

- [Standard SSO Core API](https://docs.alien.org/sso-api-reference/api-reference-core) - `@alien-id/sso`
- [Standard SSO React API](https://docs.alien.org/sso-api-reference/api-reference-react) - `@alien-id/sso-react`
- [Solana SSO Core API](https://docs.alien.org/solana-sso-api-reference/api-reference-core) - `@alien-id/sso-solana`
- [Solana SSO React API](https://docs.alien.org/solana-sso-api-reference/api-reference-react) - `@alien-id/sso-solana-react`

### Core Concepts

- [What is Alien Session?](https://docs.alien.org/what-is-alien-session) - Session architecture and lifecycle
- [What is Alien Provider?](https://docs.alien.org/what-is-alien-provider) - Provider registration and management

### Demo Applications

- [Standard SSO Demo App](https://docs.alien.org/sso-demo-app) - Example React application
- [Solana SSO Demo App](https://docs.alien.org/solana-sso-demo-app) - Example Solana dApp
- [Agent ID Demo App](https://docs.alien.org/agent-id-demo-app) - Agent guestbook with owner verification

## Development

This is a Turborepo monorepo. To work with the SDK locally:

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run in development mode (watch mode)
npm run dev

# Run tests
npm test

# Run demo apps
npm --filter example-sso-app run dev
npm --filter example-solana-sso-app run dev
```

## Getting a Provider Address

To use the SDK, you need a provider address. Register your application at the [Developer Portal](https://dev.alien.org/dashboard) to get your provider credentials.

## Features

- ✅ **TypeScript-first** with full type safety
- ✅ **Runtime validation** via Zod schemas
- ✅ **React hooks** and pre-built components
- ✅ **OIDC-compatible** standard authentication flow
- ✅ **Solana integration** with on-chain attestations
- ✅ **PKCE support** for secure authorization
- ✅ **Dual export formats**: ESM and CJS
- ✅ **Mobile-friendly** with QR code and deep link support

## Browser Support

- Modern browsers with ES2020+ support
- Chrome, Firefox, Safari, Edge (latest versions)

## Support

- 📖 [Documentation](https://docs.alien.org)
- 🐛 [Report Issues](https://github.com/alien-id/sso-sdk-js/issues)
- 💬 [Discord Community](https://discord.gg/alien)
