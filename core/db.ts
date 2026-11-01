/** Minimal async SQL interface. The app wraps @capacitor-community/sqlite (SQLCipher); tests wrap node:sqlite. */
export type SqlValue = string | number | null;

export interface SqlDb {
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  /** Same statement for many parameter sets (bulk inserts). Must be called inside transaction() for speed. */
  runMany(sql: string, paramSets: SqlValue[][]): Promise<void>;
  /** Several statements without parameters (used for migrations). */
  exec(sql: string): Promise<void>;
  /** Runs fn atomically; rolls back if it throws. Not re-entrant. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

export async function one<T = Record<string, unknown>>(db: SqlDb, sql: string, params: SqlValue[] = []): Promise<T | null> {
  const rows = await db.all<T>(sql, params);
  return rows[0] ?? null;
}
