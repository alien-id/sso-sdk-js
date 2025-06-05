import { AlienSSOConfig } from "./types";
import { sleep } from "./utils";

export class AlienSSOClient {
    private config: AlienSSOConfig;
    private pollingInterval: number;

    constructor(config: AlienSSOConfig) {
        this.config = config;
        this.pollingInterval = config.pollingInterval || 5000;
    }

    private generateCodeVerifier(): string {
        const array = new Uint32Array(56 / 2);

        window.crypto.getRandomValues(array);

        return Array.from(array, dec => ('0' + dec.toString(16)).slice(-2)).join('');
    }

    private async generateCodeChallenge(codeVerifier: string): Promise<string> {
        const encoder = new TextEncoder();

        const data = encoder.encode(codeVerifier);

        const digest = await window.crypto.subtle.digest('SHA-256', data);

        return btoa(String.fromCharCode(...new Uint8Array(digest)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }

    async authorize(): Promise<any> {
        const codeVerifier = this.generateCodeVerifier();
        const codeChallenge = await this.generateCodeChallenge(codeVerifier);

        localStorage.setItem('code_verifier', codeVerifier);

        const payload = {
            // response_type: 'code',
            // client_id: this.config.clientId,
            // redirect_uri: this.config.redirectUri,
            // scope: this.config.scopes.join(' '),
            provider_address: this.config.clientId,
            provider_signature: "?",
            code_challenge: codeChallenge,
            code_challenge_method: 'S256'
        };

        const autorizationUrl = `${this.config.authorizationEndpoint}/authorize}`;

        const response = await fetch(autorizationUrl, {
            method: 'POST',
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload.toString())
        });

        const { link, pollingCode } = await response.json();

        return { link, pollingCode };
    }

    async pollForAuthorization(pollingCode: string): Promise<string | null> {
        const pollingUrl = `${this.config.pollingEndpoint}/authorize}`;

        const payload = {
            pollingCode,
        }

        while (true) {
            const response = await fetch(pollingUrl, {
                method: 'POST',
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload.toString())
            });

            const data = await response.json();

            if (response.ok && data.authorizationCode) {
                return data.authorizationCode;
            }

            if (data.error === 'authorization_pending') {
                await sleep(this.pollingInterval);
            } else {
                throw new Error(`Polling error: ${data.error}`);
            }
        }
    }

    async getToken(authorizationCode: string): Promise<string | null> {
        if (!authorizationCode) return null;

        const codeVerifier = localStorage.getItem('code_verifier');

        if (!codeVerifier) throw new Error('Missing code verifier.');

        const tokenUrl = `${this.config.tokenEndpoint}/token}`;

        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            authorization_code: authorizationCode,
            cod_verifier: codeVerifier
            // redirect_uri: this.config.redirectUri,
            // client_id: this.config.clientId,
        });

        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        });

        const tokenData = await response.json();

        if (tokenData.access_token) {
            localStorage.setItem('access_token', tokenData.access_token);
            return tokenData.access_token;
        }

        throw new Error('Token exchange failed');
    }

    getAccessToken(): string | null {
        return localStorage.getItem('access_token');
    }

    logout(): void {
        localStorage.removeItem('access_token');
        localStorage.removeItem('code_verifier');
    }
}