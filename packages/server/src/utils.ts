import { sign, verify, createPrivateKey, createPublicKey } from 'crypto';

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export class Ed25519Signer {
    private privateKey;

    constructor(privateKeyPem: string) {
        this.privateKey = createPrivateKey(privateKeyPem);
    }

    signPayload(payload: Record<string, any>): string {
        const buffer = Buffer.from(JSON.stringify(payload));
        const signature = sign(null, buffer, this.privateKey);
        return signature.toString('base64');
    }
}

export class Ed25519Verifier {
    private publicKey;

    constructor(publicKeyPem: string) {
        this.publicKey = createPublicKey(publicKeyPem);
    }

    verifyPayload(payload: Record<string, any>, signatureBase64: string): boolean {
        const buffer = Buffer.from(JSON.stringify(payload));
        const signature = Buffer.from(signatureBase64, 'base64');
        return verify(null, buffer, this.publicKey, signature);
    }
}