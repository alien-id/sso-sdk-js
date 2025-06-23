import { PollResponse } from '@alien/sso-sdk-client-js';
import { NextRequest, NextResponse } from 'next/server';

// let counter = 0;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
    try {
        const requestBody = await request.json();

        const {
            polling_code,
        } = requestBody;

        console.log('MOCK /poll', requestBody);

        const response = await fetch('http://localhost:3000/api/mock/qr', {
            method: 'POST',
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`Poll failed: ${response.statusText}`);
        }

        const json = await response.json();

        console.log('check', json);

        if (json.status === 'authorized') {
            const pollResponse: PollResponse = {
                status: 'authorized',
                authorization_code: 'authorization_code_123'
            }
            return NextResponse.json(pollResponse);
        }

        if (json.status === 'pending') {
            const pollResponse: PollResponse = {
                status: 'pending',
            }
            return NextResponse.json(pollResponse);
        }

        // if (counter === 2) {
        //     const pollResponse: PollResponse = {
        //         status: 'authorized',
        //         authorization_code: 'authorization_code_123'
        //     }
        //     counter = 0;
        //     return NextResponse.json(pollResponse);
        // }

        // const pollResponse: PollResponse = {
        //     status: 'pending',
        // }

        // counter++;

        // const authResponse = await alienSsoSdkServer.authorize(code_challenge);
    } catch (error) {
        console.log('POST', error);

        return new NextResponse(`Authorize error`, {
            status: 400,
        })
    }
}