export type AlienSSOConfig = {
    providerAddress: string;

    providerPrivateKey: string;

    baseUrl: string;

    pollingInterval?: number;
};

export type AuthorizeRequest = {
    code_challenge: string;
    code_challenge_method: 'S256',
    provider_address: string,
    provider_signature: string,
}

export type AuthorizeResponse = {
    deep_link: string;
    polling_code: string,
    expired_at: number,
}

export type Signature = {
    code_challenge: string;
    code_challenge_method: string,
    provider_address: string,
}