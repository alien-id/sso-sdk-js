// Minimal example backend for the Alien Solana SSO primitive.
//
// It shows the recommended returning-wallet flow from docs/solana-integration.md:
//   1. issue our OWN nonce            (POST /api/nonce)
//   2. verify the wallet's signature  (verifyPopSignature — local, no Alien call)
//   3. look up the bound Alien ID     (getAttestation — L1)
//   4. mint OUR OWN session cookie    (httpOnly)
//
// Everything here is the integrator's responsibility. Alien only answers
// "which Alien identity is this wallet?" — it issues no token of its own.
//
// This store is in-memory and single-process: fine for a demo, not for prod.

import { randomBytes } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import {
  AlienSolanaSsoClient,
  buildPopMessage,
  verifyPopSignature,
} from '@alien-id/sso-solana';

const PORT = Number(process.env.PORT) || 8787;
const ssoBaseUrl = process.env.VITE_ALIEN_SSO_BASE_URL;
const providerAddress = process.env.VITE_ALIEN_PROVIDER_ADDRESS;

if (!ssoBaseUrl || !providerAddress) {
  console.error(
    'Missing VITE_ALIEN_SSO_BASE_URL / VITE_ALIEN_PROVIDER_ADDRESS. ' +
      'Copy .env.example to .env and run with `node --env-file=.env`.',
  );
  process.exit(1);
}

// The same client the SDK exposes — used here only for the L1 lookup.
const client = new AlienSolanaSsoClient({ ssoBaseUrl, providerAddress });

const NONCE_TTL_MS = 5 * 60_000;
const nonces = new Map(); // nonce -> expiresAt
const sessions = new Map(); // sessionId -> { sessionAddress, wallet }

const app = express();
app.use(express.json());
app.use(cookieParser());

// 1. Issue our own single-use, short-lived nonce.
app.post('/api/nonce', (_req, res) => {
  const nonce = randomBytes(24).toString('base64url');
  nonces.set(nonce, Date.now() + NONCE_TTL_MS);
  res.json({ nonce });
});

// 2-4. Verify possession locally, look up the binding, mint our own session.
app.post('/api/verify', async (req, res) => {
  const { wallet, nonce, signature } = req.body ?? {};
  if (!wallet || !nonce || !signature) {
    return res.status(400).json({ error: 'wallet, nonce and signature are required' });
  }

  // The nonce must be one we issued, unused, and unexpired. Consume it either
  // way so a signature can never be replayed against it.
  const expiresAt = nonces.get(nonce);
  nonces.delete(nonce);
  if (!expiresAt || expiresAt < Date.now()) {
    return res.status(401).json({ error: 'invalid or expired nonce' });
  }

  // Possession proof: standard Ed25519, no Alien call.
  const ok = verifyPopSignature(wallet, buildPopMessage(wallet, nonce), signature);
  if (!ok) {
    return res.status(401).json({ error: 'signature did not verify' });
  }

  // L1: which Alien identity is this wallet bound to?
  const sessionAddress = await client.getAttestation(wallet);
  if (!sessionAddress) {
    return res.status(403).json({ error: 'wallet is not linked to an Alien ID' });
  }

  // Mint OUR session. sub = session_address (the owner Alien ID).
  const sessionId = randomBytes(32).toString('base64url');
  sessions.set(sessionId, { sessionAddress, wallet });
  res.cookie('sid', sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60_000,
  });
  res.json({ sessionAddress, wallet });
});

// The session is ours; reading it never touches a wallet or Alien.
app.get('/api/me', (req, res) => {
  const session = sessions.get(req.cookies?.sid);
  if (!session) return res.status(401).json({ error: 'not signed in' });
  res.json(session);
});

app.post('/api/logout', (req, res) => {
  sessions.delete(req.cookies?.sid);
  res.clearCookie('sid');
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`example SSO backend on http://localhost:${PORT} (provider ${providerAddress})`);
});
