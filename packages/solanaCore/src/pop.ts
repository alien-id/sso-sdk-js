import { ed25519 } from '@noble/curves/ed25519';
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';

/**
 * Builds the exact message bytes the wallet signs for proof-of-possession.
 *
 * Proof-of-possession is the integrator's, not Alien's: the integrator issues
 * its own nonce and builds this message from it. There is no Alien endpoint and
 * no Alien secret involved — see `docs/solana-integration.md` and ADR-0002.
 */
export function buildPopMessage(solanaAddress: string, nonce: string): string {
  return (
    'Alien SSO: prove wallet control.\n' +
    `Wallet: ${solanaAddress}\n` +
    `Nonce: ${nonce}`
  );
}

/**
 * Verifies a wallet's proof-of-possession signature. Standard Ed25519 over the
 * PoP message bytes — no Alien call, no Alien secret. **Run this in your own
 * backend** after issuing your own nonce (see `docs/solana-integration.md`).
 *
 * Ed25519 verification uses `@noble/curves` — the same audited curve library
 * `@solana/web3.js` relies on internally — and decodes the base58 address with
 * `@solana/web3.js`'s `PublicKey`, so no new crypto dependency is introduced.
 *
 * This proves the holder controls `wallet` *right now*. It proves NEITHER
 * identity NOR any historical binding — pair it with the L1 lookup
 * (`AlienSolanaSsoClient.getAttestation`) to learn which Alien identity the
 * wallet is bound to. Treating either signal alone as authentication is the
 * F-06 mistake.
 *
 * Never throws: malformed input (bad address, wrong-length key/signature,
 * undecodable signature) resolves to `false` — possession is simply not proven.
 *
 * @param wallet    Solana wallet address (base58); its bytes ARE the Ed25519
 *                  public key the signature is checked against.
 * @param message   The exact message that was signed — the string from
 *                  {@link buildPopMessage}, or its raw UTF-8 bytes.
 * @param signature The wallet's signature: raw 64 bytes, or a standard
 *                  base64-encoded string of them.
 */
export function verifyPopSignature(
  wallet: string,
  message: string | Uint8Array,
  signature: string | Uint8Array,
): boolean {
  try {
    // PublicKey validates base58 and the 32-byte length, throwing otherwise.
    const publicKey = new PublicKey(wallet).toBytes();

    const messageBytes =
      typeof message === 'string' ? new TextEncoder().encode(message) : message;

    const signatureBytes =
      typeof signature === 'string'
        ? new Uint8Array(Buffer.from(signature, 'base64'))
        : signature;
    if (signatureBytes.length !== 64) return false;

    return ed25519.verify(signatureBytes, messageBytes, publicKey);
  } catch {
    return false;
  }
}
