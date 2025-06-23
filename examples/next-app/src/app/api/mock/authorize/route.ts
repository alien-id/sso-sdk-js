import { AlienSsoSdkServer } from '@alien/sso-sdk-server-js'
import { generateKeyPairSync } from 'crypto';
import { NextRequest, NextResponse } from 'next/server'

const { privateKey } = generateKeyPairSync('ed25519');

const derKey = privateKey.export({
    format: 'der',
    type: 'pkcs8',
})

const base64DER = derKey.toString('base64');

const alienSsoSdkServer = new AlienSsoSdkServer({
    providerAddress: '00000001000000000000000600000000',
    providerPrivateKey: base64DER, //'847bff014fd94b94007b5ebef9c8b1fa85996463f0c8f8a3c7be1ea7187f381e45750d05d6f2ae0c427c18e161c8432499874820dec276c89d71b908def6ff70',
    ssoBaseUrl: 'http://localhost:3005',
});

export async function POST(request: NextRequest) {
    try {
        const requestBody = await request.json();

        const {
            code_challenge,
        } = requestBody;

        const authResponse = {
            deep_link: "http://192.168.134.200:3000/api/mock/qr?query=kek",
            polling_code: '123',
            expired_at: 123,
        }

        // const authResponse = await alienSsoSdkServer.authorize(code_challenge);

        return NextResponse.json(authResponse);
    } catch (error) {
        console.log('POST', error);

        return new NextResponse(`Authorize error`, {
            status: 400,
        })
    }
}