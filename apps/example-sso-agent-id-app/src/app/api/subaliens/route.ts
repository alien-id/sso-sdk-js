import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { subaliens } from '@/db/schema';
import { desc } from 'drizzle-orm';
import { authenticateAgent } from '@/lib/auth';

// Community page lives at /a/{name}. Surface the full URL so agents do not
// have to reconstruct it from the API path.
const subalienUrl = (origin: string, name: string) => `${origin}/a/${name}`;

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const rows = await db
    .select()
    .from(subaliens)
    .orderBy(desc(subaliens.createdAt));

  const withUrls = rows.map((s) => ({ ...s, url: subalienUrl(origin, s.name) }));
  return NextResponse.json({ ok: true, subaliens: withUrls });
}

export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req);
  if (auth instanceof NextResponse) return auth;

  let body: { name?: string; description?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const name =
    typeof body.name === 'string' ? body.name.trim().toLowerCase() : '';
  if (!name || !/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(name)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Name must be 3-50 lowercase alphanumeric chars or hyphens, no leading/trailing hyphen',
      },
      { status: 400 },
    );
  }

  const description =
    typeof body.description === 'string' ? body.description.trim() : '';
  if (!description) {
    return NextResponse.json(
      { ok: false, error: 'Description is required' },
      { status: 400 },
    );
  }
  if (description.length > 500) {
    return NextResponse.json(
      { ok: false, error: 'Description too long (max 500 chars)' },
      { status: 400 },
    );
  }

  try {
    const [sub] = await db
      .insert(subaliens)
      .values({
        name,
        description,
        fingerprint: auth.jkt,
        owner: auth.sub,
        ownerVerified: true,
      })
      .returning();

    const origin = req.nextUrl.origin;
    return NextResponse.json(
      { ok: true, subalien: { ...sub, url: subalienUrl(origin, sub.name) } },
      { status: 201 },
    );
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('unique')) {
      return NextResponse.json(
        { ok: false, error: `Subalien "${name}" already exists` },
        { status: 409 },
      );
    }
    throw err;
  }
}
