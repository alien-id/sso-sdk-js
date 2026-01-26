import { Buffer } from 'buffer';
import { PublicKey } from '@solana/web3.js';

/**
 * Derive Program State PDA
 */
export function deriveProgramStatePda(
  credentialProgramId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('program_state')],
    credentialProgramId
  );
}

/**
 * Derive Credential Signer PDA
 */
export function deriveCredentialSignerPda(
  credentialProgramId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('credential_signer')],
    credentialProgramId
  );
}

/**
 * Derive Session Registry PDA
 */
export function deriveSessionRegistryPda(
  sessionRegistryProgramId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('session_registry')],
    sessionRegistryProgramId
  );
}

/**
 * Derive Session Entry PDA
 */
export function deriveSessionEntryPda(
  sessionAddress: string,
  sessionRegistryProgramId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('session'), Buffer.from(sessionAddress)],
    sessionRegistryProgramId
  );
}

/**
 * Derive Solana Entry PDA
 */
export function deriveSolanaEntryPda(
  walletPublicKey: PublicKey,
  sessionRegistryProgramId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('solana'), walletPublicKey.toBuffer()],
    sessionRegistryProgramId
  );
}

/**
 * Derive Attestation PDA using SAS program logic
 */
export function deriveAttestationPda(
  credential: PublicKey,
  schema: PublicKey,
  nonce: PublicKey,
  sasProgramId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('attestation'),
      credential.toBuffer(),
      schema.toBuffer(),
      nonce.toBuffer(),
    ],
    sasProgramId
  );
}

/**
 * Derive Credential PDA using SAS program logic
 */
export function deriveCredentialPda(
  authority: PublicKey,
  name: string,
  sasProgramId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('credential'),
      authority.toBuffer(),
      Buffer.from(name),
    ],
    sasProgramId
  );
}

/**
 * Derive Schema PDA using SAS program logic
 */
export function deriveSchemaPda(
  credential: PublicKey,
  name: string,
  version: number,
  sasProgramId: PublicKey
): [PublicKey, number] {
  const versionBuffer = Buffer.alloc(1);
  versionBuffer.writeUInt8(version);

  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('schema'),
      credential.toBuffer(),
      Buffer.from(name),
      versionBuffer,
    ],
    sasProgramId
  );
}
