import { AlienSSOClient } from '@alien/sso-sdk-server-js'

const client = new AlienSSOClient({
    providerAddress: 'your-provider-address',
    providerPrivateKey: 'your-private-key',
    baseUrl: 'https://sso.alien.com',
});

export async function POST(request: Request) {

    const res = await request.json()

    const authResponse = await client.authorize();

    return Response.json({ res })
}