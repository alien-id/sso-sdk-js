export type AlienSSOConfig = {
    clientId: string;
    redirectUri: string;
    authorizationEndpoint: string;
    pollingEndpoint: string;
    tokenEndpoint: string;
    scopes: string[];
    pollingInterval?: number; // Optional polling interval in milliseconds
};