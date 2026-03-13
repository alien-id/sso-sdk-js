# @alien-id/sso-react

React hooks and components for [Alien SSO](https://alien.org) authentication. Built on top of [@alien-id/sso](https://www.npmjs.com/package/@alien-id/sso).

## ⚠️ Alpha Version Notice

**This is an early alpha version.** The SDK is under active development and may contain bugs or undergo breaking changes. Use with caution in production environments.

## Installation

```bash
npm install @alien-id/sso-react
```

## Features

- ✅ **React 19 support** with modern hooks
- ✅ **Pre-built components** - Sign-in button and modal
- ✅ **React Query integration** for state management
- ✅ **TypeScript-first** with full type safety
- ✅ **QR code generation** with mobile deep link support
- ✅ **Animated UI** via Framer Motion
- ✅ **Responsive design** out of the box

## Documentation

📚 **Full documentation at [dev.alien.org/docs](https://dev.alien.org/docs)**

- **[React Integration Guide](https://dev.alien.org/docs/sso-guide/react-integration)** - Complete integration walkthrough
- **[API Reference](https://dev.alien.org/docs/sso-api-reference/api-reference-react)** - Detailed API documentation
- **[Demo App](https://dev.alien.org/docs/sso-demo-app)** - Example React application

### Core SDK

For vanilla JavaScript/TypeScript usage or custom implementations, see [@alien-id/sso](https://www.npmjs.com/package/@alien-id/sso).

## Authentication Flow

The SDK handles the complete flow automatically:

1. User clicks **Sign In** button
2. Modal opens with **QR code** and deep link
3. User scans QR or opens deep link in **Alien App**
4. SDK **polls** for authentication completion
5. On success, **exchanges code** for access token
6. Auth state updates, modal closes

## Custom Styling

The SDK includes default styles, but you can customize them:

```tsx
import '@alien-id/sso-react/dist/style.css'; // Optional: Import default styles

// Override with your own CSS
.alien-sso-button {
  background: your-color;
  /* ... */
}
```

## TypeScript Support

Includes full TypeScript declarations:

```typescript
import type {
  AlienSsoClientConfig,
  TokenInfo
} from '@alien-id/sso';
```

## Peer Dependencies

- `react` ^19.1.1
- `react-dom` ^19.1.1

## Getting a Provider Address

Register your application at the [Developer Portal](https://dev.alien.org/dashboard) to get your provider credentials.

## Browser Support

- Modern browsers with ES2020+ support
- Chrome, Firefox, Safari, Edge (latest versions)

## License

MIT

## Links

- [Documentation](https://dev.alien.org/docs)
- [GitHub Repository](https://github.com/alien-id/sso-sdk-js)
- [NPM Package](https://www.npmjs.com/package/@alien-id/sso-react)
- [Core SDK](https://www.npmjs.com/package/@alien-id/sso)
