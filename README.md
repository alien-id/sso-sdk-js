# Alien-SSO-SDK-JS

> Before publishing a new package, we should test it locally.
Use the "npm pack" command to create a TGZ file and you can use it in the package.json file using the "npm install relative_path_to_package_file" command.*


The `AlienSSOClient` class provides a TypeScript/JavaScript SDK for integrating with the Alien SSO (Single Sign-On) service. It handles the full SSO flow, including authorization, polling, code exchange, token verification, and session management.





## Installation

```sh
pnpm add @alien/sso-sdk-js
# or
npm install @alien/sso-sdk-js
```




## Usage Example

```typescript
import { AlienSSOClient } from 'alien-sso-sdk';

const client = new AlienSSOClient({
  providerAddress: 'your-provider-address',
  providerPrivateKey: 'your-private-key',
  baseUrl: 'https://sso.alien.com', // or your custom SSO URL
});

// 1. Start authorization
const authResponse = await client.authorize();

// 2. Poll for user authorization
const authorizationCode = await client.pollForAuthorization(authResponse.polling_code);

// 3. Exchange code for access token
const accessToken = await client.exchangeCode(authorizationCode);

// 4. Verify token
const isValid = await client.verifyToken();

// 5. Get access token directly
const token = client.getAccessToken();

// 6. Logout
client.logout();
```




## API Reference

### Constructor

```typescript
new AlienSSOClient(config: AlienSSOConfig)
```

- **config**: [`AlienSSOConfig`](#types)





### Methods

#### `authorize(): Promise<AuthorizeResponse>`

Starts the SSO authorization process.

- Generates a code verifier and challenge.
- Stores the code verifier in session storage.
- Signs the challenge and sends an authorization request.
- Returns the authorization response.

**Returns:** [`AuthorizeResponse`](#types)

---

#### `pollForAuthorization(pollingCode: string): Promise<string | null>`

Polls the SSO server to check if the user has authorized the request.

- Sends the polling code to the server at intervals.
- Resolves with the authorization code when authorized.

**Parameters:**
- `pollingCode: string` — The polling code from the authorize response.

**Returns:** `Promise<string | null>`

---

#### `exchangeCode(authorizationCode: string): Promise<string | null>`

Exchanges the authorization code for an access token.

- Uses the code verifier from session storage.
- Stores the access token in local storage.

**Parameters:**
- `authorizationCode: string` — The code received after successful authorization.

**Returns:** `Promise<string | null>`

---

#### `verifyToken(): Promise<boolean>`

Verifies the validity of the current access token.

- Throws if the token is invalid or missing.

**Returns:** `Promise<boolean>`

---

#### `getAccessToken(): string`

Retrieves the current access token from local storage.

- Throws if the token is not found.

**Returns:** `string`

---

#### `logout(): void`

Clears the access token and code verifier from storage.

**Returns:** `void`





## Types

All types are defined in [`src/schema.ts`](src/schema.ts):

### `AlienSSOConfig`

```typescript
{
  providerAddress: string;
  providerPrivateKey: string;
  baseUrl: string;
  pollingInterval?: number;
}
```

### `AuthorizeRequest`

```typescript
{
  code_challenge: string;
  code_challenge_method: 'S256';
  provider_address: string;
  provider_signature: string;
}
```

### `AuthorizeResponse`

```typescript
{
  deep_link: string;
  polling_code: string;
  expired_at: number;
}
```

### `PollRequest`

```typescript
{
  polling_code: string;
}
```

### `PollResponse`

```typescript
{
  status: 'pending' | 'authorized' | ...;
  authorization_code?: string;
}
```

### `ExchangeCodeRequest`

```typescript
{
  authorization_code: string;
  code_verifier: string;
}
```

### `ExchangeCodeResponse`

```typescript
{
  access_token: string;
}
```

### `VerifyTokenRequest`

```typescript
{
  access_token: string;
}
```

### `VerifyTokenResponse`

```typescript
{
  is_valid: boolean;
}
```




## How to test SDK package locally or run examples

From the root:

```sh
pnpm install                      # installs all dependencies, links your SDK
pnpm build                        # builds the SDK
pnpm --filter react-app run dev   # or --filter nextjs-app
```

## Recommended Flow for SDK Auth

- Frontend exchanges auth_code → receives access_token

- Frontend SDK stores access_token in memory

- All API requests use Authorization: Bearer ... header

- Backend verifies token signature and scopes

- Optionally, refresh tokens using a secure flow when expired