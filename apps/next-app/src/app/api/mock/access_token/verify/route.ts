import { VerifyTokenResponse } from '@alien/sso-sdk-client-js';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    try {
        const requestBody = await request.json();

        const {
            access_token,
        } = requestBody;

        console.log('MOCK /verify', requestBody);

        if (access_token === 'access_token_123') {
            const verifyResponse: VerifyTokenResponse = {
                is_valid: true
            }

            return NextResponse.json(verifyResponse);
        }

        const verifyResponse: VerifyTokenResponse = {
            is_valid: false
        }

        return NextResponse.json(verifyResponse);
    } catch (error) {
        console.log('POST', error);

        return new NextResponse(`Authorize error`, {
            status: 400,
        })
    }
}