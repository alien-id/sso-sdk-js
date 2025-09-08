import { AlienSsoSdkServer } from '@alien/sso-sdk-server-js'
import { NextRequest, NextResponse } from 'next/server'

const alienSsoSdkServer = new AlienSsoSdkServer({
    providerAddress: '00000001000000000000001400000000',
    providerPrivateKey: 'f65a779912afa285668ac6ad553f354db7cdb781364dd04238c70b8583f090303fa6921c3d79e40833d372f5ffcfceaf29844930da55b8d5b00ea1428ce0d268',
    ssoBaseUrl: 'https://sso.alien-api.com',
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