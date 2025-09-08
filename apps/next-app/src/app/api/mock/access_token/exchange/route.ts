import { PollResponse } from '@alien/sso-sdk-client-js';
import { ExchangeCodeResponse } from '@alien/sso-sdk-server-js';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    try {
        const requestBody = await request.json();

        const {
            authorization_code: authorizationCode,
            code_verifier: codeVerifier,
        } = requestBody;

        console.log('MOCK /exchange', requestBody);

        const pollResponse: ExchangeCodeResponse = {
            access_token: 'access_token_123'
        }

        return NextResponse.json(pollResponse);
    } catch (error) {
        console.log('POST', error);

        return new NextResponse(`Authorize error`, {
            status: 400,
        })
    }
}