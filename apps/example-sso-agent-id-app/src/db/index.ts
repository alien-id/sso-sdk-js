import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const globalForDb = globalThis as unknown as { _db: ReturnType<typeof drizzle> };

function createDb() {
  const client = postgres(process.env.DATABASE_URL!, { max: 10 });
  return drizzle(client, { schema });
}

export const db = globalForDb._db ?? createDb();

if (process.env.NODE_ENV !== 'production') {
  globalForDb._db = db;
}
