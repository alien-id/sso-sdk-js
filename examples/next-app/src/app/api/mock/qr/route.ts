import { PollResponse } from '@alien/sso-sdk-client-js';
import { NextRequest, NextResponse } from 'next/server';

let isQrScanned = false;

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams
        const query = searchParams.get('query')

        console.log('MOCK /qr GET', query);

        isQrScanned = true;

        const response = {
            status: 'authorized',
        }

        return NextResponse.json(response);
    } catch (error) {
        console.log('POST', error);

        return new NextResponse(`Error`, {
            status: 400,
        })
    }
}

export async function POST(request: NextRequest) {
    try {
        const requestBody = await request.json();

        const {
            polling_code
        } = requestBody;

        console.log('MOCK /qr POST', requestBody);

        const pollResponse: PollResponse = {
            status: isQrScanned ? 'authorized' : 'pending',
        }

        return NextResponse.json(pollResponse);
    } catch (error) {
        console.log('POST', error);

        return new NextResponse(`Authorize error`, {
            status: 400,
        })
    }
}