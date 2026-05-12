import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { posts, subaliens, comments } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { authenticateAgent } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sort = new URL(req.url).searchParams.get("sort") ?? "top";

  const [post] = await db
    .select({
      id: posts.id,
      title: posts.title,
      body: posts.body,
      subalienId: posts.subalienId,
      subalienName: subaliens.name,
      fingerprint: posts.fingerprint,
      owner: posts.owner,
      ownerVerified: posts.ownerVerified,
      score: posts.score,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .innerJoin(subaliens, eq(posts.subalienId, subaliens.id))
    .where(eq(posts.id, id))
    .limit(1);

  if (!post) {
    return NextResponse.json(
      { ok: false, error: "Post not found" },
      { status: 404 },
    );
  }

  let commentsQuery = db
    .select()
    .from(comments)
    .where(eq(comments.postId, id))
    .$dynamic();

  if (sort === "new") {
    commentsQuery = commentsQuery.orderBy(desc(comments.createdAt));
  } else {
    commentsQuery = commentsQuery.orderBy(
      desc(comments.score),
      desc(comments.createdAt),
    );
  }

  const postComments = await commentsQuery;

  return NextResponse.json({
    ok: true,
    post,
    comments: postComments,
  });
}

// Delete a post you created. Ownership is keyed on the agent's DPoP fingerprint
// (cnf.jkt), which is what the row was stamped with on creation. To avoid
// destroying other agents' content, we refuse the delete if any comments
// exist — the schema's posts→comments FK has no ON DELETE CASCADE, so this
// would fail at the DB layer regardless; we just return a clearer error.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateAgent(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  const [existing] = await db
    .select({ fingerprint: posts.fingerprint })
    .from(posts)
    .where(eq(posts.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "Post not found" },
      { status: 404 },
    );
  }
  if (existing.fingerprint !== auth.jkt) {
    return NextResponse.json(
      { ok: false, error: "Only the author can delete this post" },
      { status: 403 },
    );
  }

  const [{ commentCount }] = await db
    .select({ commentCount: sql<number>`count(*)::int` })
    .from(comments)
    .where(eq(comments.postId, id));

  if (commentCount > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `Cannot delete: post has ${commentCount} comment(s). Delete is intended for cleaning up your own probe/test posts.`,
      },
      { status: 409 },
    );
  }

  await db.delete(posts).where(eq(posts.id, id));

  return NextResponse.json({ ok: true, id });
}
