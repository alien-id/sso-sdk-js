# @alien_org/sso-sdk-core

Core TypeScript client for [Alien SSO](https://alien.org) authentication. Provides OIDC-compatible authentication with blockchain and TEE backing.

## Installation

```bash
npm install @alien_org/sso-sdk-core
```

## Features

- ✅ **TypeScript-first** with full type safety
- ✅ **Runtime validation** via Zod schemas
- ✅ **PKCE support** for secure authorization
- ✅ **Dual exports**: ESM and CJS
- ✅ **Zero UI dependencies** - use in any JavaScript environment
- ✅ **Storage management** for tokens and session data

## Documentation

📚 **Full documentation at [dev.alien.org/docs](https://dev.alien.org/docs)**

- **[Integration Guide](https://dev.alien.org/docs/sso-guide/core-integration)** - Complete integration walkthrough
- **[API Reference](https://dev.alien.org/docs/sso-api-reference/api-reference-core)** - Detailed API documentation
- **[What is Alien Session?](https://dev.alien.org/docs/what-is-alien-session)** - Session architecture explained
- **[Demo App](https://dev.alien.org/docs/sso-demo-app)** - Example application

### React Integration

If you're using React, check out [@alien_org/sso-sdk-react](https://www.npmjs.com/package/@alien_org/sso-sdk-react) for hooks and pre-built components:

```bash
npm install @alien_org/sso-sdk-react
```

## Authentication Flow

1. **Generate deeplink** → Display QR code or redirect
2. **User authenticates** in Alien mobile app
3. **Poll for completion** → Get authorization code
4. **Exchange code** → Receive access token
5. **Verify token** → Validate with server (optional)

## Storage

The SDK uses browser storage for session management:

- **localStorage**: `alien-sso_access_token` - Access token
- **sessionStorage**: `alien-sso_code_verifier` - PKCE code verifier

## Getting a Provider Address

Register your application at the [Developer Portal](https://dev.alien.org/dashboard) to get your provider credentials.

## TypeScript Support

Includes full TypeScript declarations with Zod runtime validation:

```typescript
import type {
  AlienSsoClientConfig,
  AuthorizeResponse,
  PollResponse,
  ExchangeCodeResponse,
  TokenInfo
} from '@alien_org/sso-sdk-core';
```

## Browser Support

- Modern browsers with ES2020+ support
- Chrome, Firefox, Safari, Edge (latest versions)

## License

MIT

## Links

- [Documentation](https://dev.alien.org/docs)
- [GitHub Repository](https://github.com/alien-org/sso-sdk-js)
- [NPM Package](https://www.npmjs.com/package/@alien_org/sso-sdk-core)
