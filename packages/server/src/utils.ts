export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Wrap into PKCS#8 structure (required by crypto.createPrivateKey)
export function wrapEd25519PrivateKey(rawKey: Buffer<ArrayBuffer>) {
    if (rawKey.length !== 64) throw new Error("Expected 64-byte Ed25519 key");

    // PKCS#8 DER structure prefix for Ed25519 + 32-byte secret key
    const pkcs8Prefix = Buffer.from([
        0x30, 0x2e,
        0x02, 0x01, 0x00,
        0x30, 0x05,
        0x06, 0x03, 0x2b, 0x65, 0x70,
        0x04, 0x22,
        0x04, 0x20
    ]);

    const pkcs8Key = Buffer.concat([
        pkcs8Prefix,
        rawKey.subarray(0, 32) // Use only the 32-byte seed (secret)
    ]);

    return pkcs8Key;
}