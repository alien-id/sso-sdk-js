import { NextRequest, NextResponse } from 'next/server';

export function GET(req: NextRequest) {
  const url = new URL(req.url);
  const origin = `${url.protocol}//${url.host}`;
  return NextResponse.json({
    version: 1,
    auth_endpoint: `${origin}/api/agent-auth`,
    header_name: 'Authorization',
    api_base_url: `${origin}/api`,
    openapi: `${origin}/openapi.json`,
  });
}
