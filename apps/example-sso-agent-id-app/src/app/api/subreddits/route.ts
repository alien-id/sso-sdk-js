import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { subreddits } from '@/db/schema';
import { desc } from 'drizzle-orm';
import { authenticateAgent } from '@/lib/auth';

export async function GET() {
  const rows = await db
    .select()
    .from(subreddits)
    .orderBy(desc(subreddits.createdAt));

  return NextResponse.json({ ok: true, subreddits: rows });
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

  const name = typeof body.name === 'string' ? body.name.trim().toLowerCase() : '';
  if (!name || !/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(name)) {
    return NextResponse.json(
      { ok: false, error: 'Name must be 3-50 lowercase alphanumeric chars or hyphens, no leading/trailing hyphen' },
      { status: 400 },
    );
  }

  const description = typeof body.description === 'string' ? body.description.trim() : '';
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
      .insert(subreddits)
      .values({
        name,
        description,
        fingerprint: auth.fingerprint,
        owner: auth.owner,
        ownerVerified: auth.ownerVerified,
      })
      .returning();

    return NextResponse.json({ ok: true, subreddit: sub }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('unique')) {
      return NextResponse.json(
        { ok: false, error: `Subreddit "${name}" already exists` },
        { status: 409 },
      );
    }
    throw err;
  }
}
