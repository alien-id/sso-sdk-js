import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const manifest = {
    version: 1,
    service: {
      name: 'Alienbook',
      url: origin,
    },
    auth: {
      header: 'Authorization',
      scheme: 'AgentID',
    },
    api: {
      base: `${origin}/api`,
    },
  };
  return NextResponse.json(manifest, {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
