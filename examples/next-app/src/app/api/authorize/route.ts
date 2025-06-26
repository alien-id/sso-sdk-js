import { AlienSsoSdkServer } from '@alien/sso-sdk-server-js'
import { NextRequest, NextResponse } from 'next/server'

const alienSsoSdkServer = new AlienSsoSdkServer({
    providerAddress: '00000001000000000000000700000000',
    providerPrivateKey: '7fcf26c0d12ad6053a57400706d6fdd4876c468aeb9740e33244d44852007d4419a062d9bf12bba2e558043b86fad7436280da93dc6b653f7dde12abfa793e20',
    ssoBaseUrl: 'http://localhost:3005',
});

export async function POST(request: NextRequest) {
    try {
        const requestBody = await request.json();

        const {
            code_challenge,
        } = requestBody;

        console.log('code_challenge', code_challenge);

        const authResponse = await alienSsoSdkServer.authorize(code_challenge);

        return NextResponse.json(authResponse);
    } catch (error) {
        console.log('POST', error);

        return new NextResponse(`Authorize error`, {
            status: 400,
        })
    }
}