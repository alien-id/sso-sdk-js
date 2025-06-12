export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function makeSignature(
    encodedSignaturePayload: BufferSource,
    _privateKey?: string,
): Promise<string> {
    // Todo: crypto.subtle.importKey
    const { publicKey, privateKey } = await crypto.subtle.generateKey(
        {
            name: "Ed25519",
        },
        true,
        ["sign", "verify"],
    );

    console.log('{ publicKey, privateKey }', { publicKey, privateKey });

    const signature = await crypto.subtle.sign(
        {
            name: "Ed25519",
        },
        privateKey,
        encodedSignaturePayload,
    );

    console.log('{ signature }', { signature, buff: new Uint8Array(signature) });

    const isValid = await crypto.subtle.verify(
        {
            name: "Ed25519"
        },
        publicKey,
        signature,
        encodedSignaturePayload
    );

    console.log('isValid', { isValid });

    return btoa(String.fromCharCode(...new Uint8Array(signature)));
}