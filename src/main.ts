import { AlienSSOConfig } from "./types";
import { sleep } from "./utils";

const DEFAULT_BASEURL = 'https://sso.alien.com';

export class AlienSSOClient {
    readonly config: AlienSSOConfig;
    readonly pollingInterval: number;
    readonly baseUrl: string;

    constructor(config: AlienSSOConfig) {
        this.config = config;

        this.baseUrl = this.config.baseUrl || DEFAULT_BASEURL;

        this.pollingInterval = this.config.pollingInterval || 5000;
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

        sessionStorage.setItem('code_verifier', codeVerifier);

        const authorizePayload = {
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            provider_address: this.config.providerAddress,
            provider_authorize_signature_hex: "?",
        };

        const autorizationUrl = `${this.config.baseUrl}/authorize}`;

        const response = await fetch(autorizationUrl, {
            method: 'POST',
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(authorizePayload)
        });

        const { link, callbackUrl, pollingCode } = await response.json();

        return { link, callbackUrl, pollingCode };
    }

    async pollForAuthorization(pollingCode: string): Promise<string | null> {
        const pollingUrl = `${this.config.baseUrl}/poll}`;

        const payload = {
            pollingCode,
        }

        while (true) {
            const response = await fetch(pollingUrl, {
                method: 'POST',
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload)
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

        const codeVerifier = sessionStorage.getItem('code_verifier');

        if (!codeVerifier) throw new Error('Missing code verifier.');

        const tokenUrl = `${this.config.baseUrl}/token}`;

        const payload = {
            authorization_code: authorizationCode,
            code_verifier: codeVerifier
        };

        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.access_token) {
            localStorage.setItem('access_token', data.access_token);
            return data.access_token;
        }

        throw new Error('Token exchange failed');
    }

    getAccessToken(): string | null {
        return localStorage.getItem('access_token');
    }

    async isAuthorized(): Promise<boolean> {
        const isAuthorizedUrl = `${this.config.baseUrl}/verify}`;

        const payload = {
            access_token: this.getAccessToken(),
        }

        const response = await fetch(isAuthorizedUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: JSON.stringify(payload),
        });

        if (response.status !== 403) {
            return false;
        }

        return true;
    }

    logout(): void {
        localStorage.removeItem('access_token');
        sessionStorage.removeItem('code_verifier');
    }
}