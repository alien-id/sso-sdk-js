import { Buffer } from 'buffer';
import {
  SolanaLinkRequest,
  SolanaLinkRequestSchema,
  SolanaLinkResponse,
  SolanaLinkResponseSchema,
  SolanaPollRequest,
  SolanaPollRequestSchema,
  SolanaPollResponse,
  SolanaPollResponseSchema,
  SolanaAttestationRequest,
  SolanaAttestationRequestSchema,
  SolanaAttestationResponse,
  SolanaAttestationResponseSchema,
} from './schema';
import { z } from 'zod/v4-mini';
import {
  Ed25519Program,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionInstruction,
  Connection,
} from '@solana/web3.js';
import {
  deriveProgramStatePda,
  deriveCredentialSignerPda,
  deriveSessionRegistryPda,
  deriveSessionEntryPda,
  deriveSolanaEntryPda,
  deriveAttestationPda,
} from './pda';

const SSO_BASE_URL = 'https://sso.alien-api.com';
const POLLING_INTERVAL = 5000;

// Default Solana program IDs
const DEFAULT_CREDENTIAL_SIGNER_PROGRAM_ID = '9cstDz8WWRAFaq1vVpTjfHz6tjgh6SJaqYFeZWi1pFHG';
const DEFAULT_SESSION_REGISTRY_PROGRAM_ID = 'DeHa6pyZ2CFSbQQiNMm7FgoCXqmkX6tXG77C4Qycpta6';
const DEFAULT_SAS_PROGRAM_ID = '22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG'; // Solana Attestation Service

const joinUrl = (base: string, path: string): string => {
  return new URL(path, base).toString();
};

export const AlienSolanaSsoClientSchema = z.object({
  ssoBaseUrl: z.url(),
  providerAddress: z.string(),
  pollingInterval: z.optional(z.number()),
  credentialSignerProgramId: z.optional(z.string()),
  sasProgramId: z.optional(z.string()),
  sessionRegistryProgramId: z.optional(z.string()),
  allowInsecureSsoBaseUrl: z.optional(z.boolean()),
});

export type AlienSolanaSsoClientConfig = z.infer<typeof AlienSolanaSsoClientSchema>;

// RFC 6749 §10: bearer credentials and refresh tokens MUST be transmitted
// over TLS. Mirrors `@alien-id/sso/core` so the Solana flow does not become
// the weak link if an integrator points it at an http:// endpoint.
function assertSsoBaseUrlSafe(
  ssoBaseUrl: string,
  allowInsecure: boolean,
): void {
  let url: URL;
  try {
    url = new URL(ssoBaseUrl);
  } catch {
    throw new Error(`ssoBaseUrl is not a valid URL: ${ssoBaseUrl}`);
  }
  if (url.protocol === 'https:') return;
  if (url.protocol === 'http:') {
    if (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '[::1]' ||
      allowInsecure
    ) {
      return;
    }
    throw new Error(
      `ssoBaseUrl must use https:// (got ${url.protocol}//${url.host}); set allowInsecureSsoBaseUrl: true to override in dev`,
    );
  }
  throw new Error(
    `ssoBaseUrl must use https:// (got ${url.protocol}//${url.host})`,
  );
}

export class AlienSolanaSsoClient {
  readonly config: AlienSolanaSsoClientConfig;
  readonly pollingInterval: number;
  readonly ssoBaseUrl: string;
  readonly providerAddress: string;
  readonly credentialSignerProgramId: PublicKey;
  readonly sasProgramId: PublicKey;
  readonly sessionRegistryProgramId: PublicKey;

  constructor(config: AlienSolanaSsoClientConfig) {
    this.config = AlienSolanaSsoClientSchema.parse(config);

    this.ssoBaseUrl = this.config.ssoBaseUrl || SSO_BASE_URL;
    assertSsoBaseUrlSafe(
      this.ssoBaseUrl,
      this.config.allowInsecureSsoBaseUrl === true,
    );
    this.providerAddress = this.config.providerAddress;
    this.pollingInterval = this.config.pollingInterval || POLLING_INTERVAL;

    this.credentialSignerProgramId = new PublicKey(
      this.config.credentialSignerProgramId || DEFAULT_CREDENTIAL_SIGNER_PROGRAM_ID
    );
    this.sasProgramId = new PublicKey(
      this.config.sasProgramId || DEFAULT_SAS_PROGRAM_ID
    );
    this.sessionRegistryProgramId = new PublicKey(
      this.config.sessionRegistryProgramId || DEFAULT_SESSION_REGISTRY_PROGRAM_ID
    );
  }

  async generateDeeplink(solanaAddress: string): Promise<SolanaLinkResponse> {
    const linkPayload: SolanaLinkRequest = {
      solana_address: solanaAddress,
    };

    SolanaLinkRequestSchema.parse(linkPayload);

    const linkUrl = joinUrl(this.config.ssoBaseUrl, '/solana/link');

    const response = await fetch(linkUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PROVIDER-ADDRESS': this.providerAddress,
      },
      body: JSON.stringify(linkPayload),
    });

    if (!response.ok) {
      throw new Error(`GenerateLinkDeeplink failed: ${response.statusText}`);
    }

    const json = await response.json();

    return SolanaLinkResponseSchema.parse(json);
  }

  async pollAuth(pollingCode: string): Promise<SolanaPollResponse> {
    const pollPayload: SolanaPollRequest = {
      polling_code: pollingCode,
    };

    SolanaPollRequestSchema.parse(pollPayload);

    const response = await fetch(
      joinUrl(this.config.ssoBaseUrl, '/solana/poll'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PROVIDER-ADDRESS': this.providerAddress,
        },
        body: JSON.stringify(pollPayload),
      },
    );

    if (!response.ok) {
      throw new Error(`Poll failed: ${response.statusText}`);
    }

    const json = await response.json();
    return SolanaPollResponseSchema.parse(json);
  }

  async getAttestation(solanaAddress: string): Promise<string | null> {
    const attestationPayload: SolanaAttestationRequest = {
      solana_address: solanaAddress,
    };

    SolanaAttestationRequestSchema.parse(attestationPayload);

    const response = await fetch(
      joinUrl(this.config.ssoBaseUrl, '/solana/attestation'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PROVIDER-ADDRESS': this.providerAddress,
        },
        body: JSON.stringify(attestationPayload),
      },
    );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`GetAttestation failed: ${response.statusText}`);
    }

    const json = await response.json();

    const attestationResponse: SolanaAttestationResponse =
      SolanaAttestationResponseSchema.parse(json);

    return attestationResponse.session_address;
  }

  async buildCreateAttestationTransaction(params: {
    connection: Connection;
    payerPublicKey: PublicKey;
    sessionAddress: string;
    oracleSignature: Uint8Array;
    oraclePublicKey: PublicKey;
    timestamp: number;
    expiry: number;
  }): Promise<Transaction> {
    const {
      connection,
      payerPublicKey,
      sessionAddress,
      oracleSignature,
      oraclePublicKey,
      timestamp,
      expiry,
    } = params;

    // Derive program state PDA and fetch it to get credential and schema addresses
    const [programStateAddress] = deriveProgramStatePda(this.credentialSignerProgramId);
    const programStateAccount = await connection.getAccountInfo(programStateAddress);

    if (!programStateAccount) {
      throw new Error('ProgramState account not found');
    }

    // ProgramState layout: 8-byte Anchor discriminator followed by six 32-byte
    // Pubkeys (oracle_pubkey, credential_pda, schema_pda, event_authority_pda,
    // authority, session_registry). A malicious or misconfigured RPC could
    // serve bytes from any account; validating owner and minimum length
    // before slicing fields prevents transaction assembly from being steered
    // by attacker-controlled data.
    if (!programStateAccount.owner.equals(this.credentialSignerProgramId)) {
      throw new Error(
        `ProgramState owner mismatch: expected ${this.credentialSignerProgramId.toBase58()}, got ${programStateAccount.owner.toBase58()}`,
      );
    }
    const PROGRAM_STATE_MIN_LEN = 8 + 32 * 6;
    if (programStateAccount.data.length < PROGRAM_STATE_MIN_LEN) {
      throw new Error(
        `ProgramState data too short: ${programStateAccount.data.length} < ${PROGRAM_STATE_MIN_LEN}`,
      );
    }

    // Deserialize ProgramState (skip 8-byte discriminator)
    // struct ProgramState { oracle_pubkey: Pubkey, credential_pda: Pubkey, schema_pda: Pubkey, event_authority_pda: Pubkey, authority: Pubkey, session_registry: Pubkey }
    const data = programStateAccount.data;
    const onChainOraclePubkey = new PublicKey(data.slice(8, 8 + 32));
    const credentialAddress = new PublicKey(data.slice(8 + 32, 8 + 64)); // Skip discriminator + oracle_pubkey
    const schemaAddress = new PublicKey(data.slice(8 + 64, 8 + 96)); // Skip discriminator + oracle_pubkey + credential_pda

    // Cross-check: the oracle key the backend handed us in the poll response
    // MUST equal the oracle key recorded on-chain. Without this gate a
    // backend-side compromise could swap in an attacker-controlled oracle key
    // whose Ed25519 signature still passes the in-transaction precompile check.
    if (!onChainOraclePubkey.equals(oraclePublicKey)) {
      throw new Error(
        `Oracle pubkey mismatch: on-chain ${onChainOraclePubkey.toBase58()}, backend-supplied ${oraclePublicKey.toBase58()}`,
      );
    }

    // Derive other PDAs
    const [credentialSignerAddress] = deriveCredentialSignerPda(this.credentialSignerProgramId);
    const [sessionRegistryAddress] = deriveSessionRegistryPda(this.sessionRegistryProgramId);
    const [sessionEntryAddress] = deriveSessionEntryPda(sessionAddress, this.sessionRegistryProgramId);
    const [solanaEntryAddress] = deriveSolanaEntryPda(payerPublicKey, this.sessionRegistryProgramId);
    const [attestationAddress] = deriveAttestationPda(
      credentialAddress,
      schemaAddress,
      payerPublicKey,
      this.sasProgramId
    );

    // Create Oracle signature verification message
    const timestampBuffer = Buffer.alloc(8);
    timestampBuffer.writeBigInt64LE(BigInt(timestamp));

    const oracleMessage = Buffer.concat([
      Buffer.from(sessionAddress),
      Buffer.from(payerPublicKey.toBase58()),
      timestampBuffer,
    ]);

    // Ed25519 instruction for Oracle signature verification
    const ed25519Instruction = Ed25519Program.createInstructionWithPublicKey({
      publicKey: oraclePublicKey.toBytes(),
      message: oracleMessage,
      signature: oracleSignature,
    });

    // Serialize create attestation instruction data
    const createAttestationData = this.serializeCreateAttestationInstruction(
      sessionAddress,
      Array.from(oracleSignature),
      expiry,
      timestamp,
    );

    // Create attestation instruction
    const createAttestationInstruction = new TransactionInstruction({
      keys: [
        { pubkey: programStateAddress, isSigner: false, isWritable: false },
        { pubkey: credentialSignerAddress, isSigner: false, isWritable: false },
        { pubkey: payerPublicKey, isSigner: true, isWritable: true },
        { pubkey: credentialAddress, isSigner: false, isWritable: false },
        { pubkey: schemaAddress, isSigner: false, isWritable: false },
        { pubkey: attestationAddress, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: this.sasProgramId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: this.sessionRegistryProgramId, isSigner: false, isWritable: false },
        { pubkey: sessionRegistryAddress, isSigner: false, isWritable: true },
        { pubkey: sessionEntryAddress, isSigner: false, isWritable: true },
        { pubkey: solanaEntryAddress, isSigner: false, isWritable: true },
      ],
      programId: this.credentialSignerProgramId,
      data: createAttestationData,
    });

    const transaction = new Transaction();
    transaction.add(ed25519Instruction);
    transaction.add(createAttestationInstruction);

    return transaction;
  }

  private serializeCreateAttestationInstruction(
    sessionAddress: string,
    oracleSignature: number[],
    expiry: number,
    timestamp: number,
  ): Buffer {
    const discriminator = Buffer.from([
      49, 24, 67, 80, 12, 249, 96, 239,
    ]);

    const sessionAddressLength = Buffer.alloc(4);
    sessionAddressLength.writeUInt32LE(sessionAddress.length);

    const sessionAddressBytes = Buffer.from(sessionAddress);

    const signatureBuffer = Buffer.from(oracleSignature);

    const expiryBuffer = Buffer.alloc(8);
    expiryBuffer.writeBigInt64LE(BigInt(expiry));

    const timestampBuffer = Buffer.alloc(8);
    timestampBuffer.writeBigInt64LE(BigInt(timestamp));

    return Buffer.concat([
      discriminator,
      sessionAddressLength,
      sessionAddressBytes,
      signatureBuffer,
      expiryBuffer,
      timestampBuffer,
    ]);
  }
}
