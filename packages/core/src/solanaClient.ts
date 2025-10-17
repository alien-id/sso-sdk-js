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
} from './solanaSchema';
import { z } from 'zod/v4-mini';
import {
  Ed25519Program,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  deriveProgramStatePda,
  deriveCredentialSignerPda,
  deriveSessionRegistryPda,
  deriveSessionEntryPda,
  deriveSolanaEntryPda,
  deriveAttestationPda,
  deriveCredentialPda,
  deriveSchemaPda,
} from './solanaPda';

const SSO_BASE_URL = 'https://sso.alien.com';
const POLLING_INTERVAL = 5000;

// Default Solana program IDs
const DEFAULT_CREDENTIAL_SIGNER_PROGRAM_ID = '9cstDz8WWRAFaq1vVpTjfHz6tjgh6SJaqYFeZWi1pFHG';
const DEFAULT_SAS_PROGRAM_ID = '22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG'; // Solana Attestation Service
const DEFAULT_SESSION_REGISTRY_PROGRAM_ID = 'SessionRegistryProgramId11111111111111111'; // TODO: replace with actual

// Default credential and schema parameters
const DEFAULT_CREDENTIAL_AUTHORITY = '11111111111111111111111111111111';
const DEFAULT_CREDENTIAL_NAME = 'default_credential';
const DEFAULT_SCHEMA_NAME = 'default_schema';
const DEFAULT_SCHEMA_VERSION = 1;

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
  credentialAuthority: z.optional(z.string()),
  credentialName: z.optional(z.string()),
  schemaName: z.optional(z.string()),
  schemaVersion: z.optional(z.number()),
});

export type AlienSolanaSsoClientConfig = z.infer<typeof AlienSolanaSsoClientSchema>;

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

  async generateLinkDeeplink(solanaAddress: string): Promise<SolanaLinkResponse> {
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

  async getAttestation(solanaAddress: string): Promise<string> {
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

    if (!response.ok) {
      throw new Error(`GetAttestation failed: ${response.statusText}`);
    }

    const json = await response.json();

    const attestationResponse: SolanaAttestationResponse =
      SolanaAttestationResponseSchema.parse(json);

    return attestationResponse.session_address;
  }


  buildCreateAttestationTransaction(params: {
    payerPublicKey: PublicKey;
    sessionAddress: string;
    oracleSignature: Uint8Array;
    oraclePublicKey: PublicKey;
    timestamp: number;
    expiry: number;
  }): Transaction {
    const {
      payerPublicKey,
      sessionAddress,
      oracleSignature,
      oraclePublicKey,
      timestamp,
      expiry,
    } = params;

    // Generate credential and schema addresses
    const credentialAuthority = this.config.credentialAuthority || DEFAULT_CREDENTIAL_AUTHORITY;
    const credentialName = this.config.credentialName || DEFAULT_CREDENTIAL_NAME;
    const schemaName = this.config.schemaName || DEFAULT_SCHEMA_NAME;
    const schemaVersion = this.config.schemaVersion ?? DEFAULT_SCHEMA_VERSION;

    const [credentialAddress] = deriveCredentialPda(
      new PublicKey(credentialAuthority),
      credentialName,
      this.sasProgramId
    );

    const [schemaAddress] = deriveSchemaPda(
      credentialAddress,
      schemaName,
      schemaVersion,
      this.sasProgramId
    );

    // Derive all PDAs
    const [programStateAddress] = deriveProgramStatePda(this.credentialSignerProgramId);
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
      0x9b, 0x8f, 0x4c, 0x6a, 0x3f, 0x59, 0x3e, 0x57,
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
