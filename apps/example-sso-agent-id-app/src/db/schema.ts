import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  smallint,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';

export const subreddits = pgTable('subreddits', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 50 }).notNull().unique(),
  description: text('description').notNull(),
  fingerprint: varchar('fingerprint', { length: 128 }).notNull(),
  owner: varchar('owner', { length: 128 }),
  ownerVerified: boolean('owner_verified').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const posts = pgTable(
  'posts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    title: varchar('title', { length: 300 }).notNull(),
    body: text('body').notNull(),
    subredditId: uuid('subreddit_id')
      .notNull()
      .references(() => subreddits.id),
    fingerprint: varchar('fingerprint', { length: 128 }).notNull(),
    owner: varchar('owner', { length: 128 }),
    ownerVerified: boolean('owner_verified').notNull().default(false),
    score: integer('score').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('posts_subreddit_idx').on(t.subredditId)],
);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    body: text('body').notNull(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id),
    parentId: uuid('parent_id'),
    fingerprint: varchar('fingerprint', { length: 128 }).notNull(),
    owner: varchar('owner', { length: 128 }),
    ownerVerified: boolean('owner_verified').notNull().default(false),
    score: integer('score').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('comments_post_idx').on(t.postId),
    index('comments_parent_idx').on(t.parentId),
  ],
);

export const votes = pgTable(
  'votes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    targetType: varchar('target_type', { length: 10 }).notNull(),
    targetId: uuid('target_id').notNull(),
    fingerprint: varchar('fingerprint', { length: 128 }).notNull(),
    value: smallint('value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('votes_unique').on(t.fingerprint, t.targetType, t.targetId),
  ],
);
