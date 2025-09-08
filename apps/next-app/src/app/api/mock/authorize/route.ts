import { AlienSsoSdkServer } from '@alien/sso-sdk-server-js'
// import { generateKeyPairSync } from 'crypto';
import { NextRequest, NextResponse } from 'next/server'

// const { privateKey } = generateKeyPairSync('ed25519');

// const derKey = privateKey.export({
//     format: 'der',
//     type: 'pkcs8',
// })

// const base64DER = derKey.toString('base64');

const alienSsoSdkServer = new AlienSsoSdkServer({
    providerAddress: '00000001000000000000000300000000',
    providerPrivateKey: 'a15a08dcbe8bc51b6dbc31cde958a2c8c01571bdb66775b702431b2515a6e939eca3b7188b52a4affd87d8ee8b0714402efcf5755848f91f801b302dca2acf85',
    ssoBaseUrl: 'http://localhost:3005',
});

export async function POST(request: NextRequest) {
    try {
        const requestBody = await request.json();

        const {
            code_challenge,
        } = requestBody;

        console.log('code_challenge', code_challenge);


        // const authResponse = {
        //     deep_link: "http://192.168.134.200:3000/api/mock/qr?query=kek",
        //     polling_code: '123',
        //     expired_at: 123,
        // }

        const authResponse = await alienSsoSdkServer.authorize(code_challenge);

        return NextResponse.json(authResponse);
    } catch (error) {
        console.log('POST', error);

        return new NextResponse(`Authorize error`, {
            status: 400,
        })
    }
}