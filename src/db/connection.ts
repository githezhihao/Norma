import Database from 'better-sqlite3';
import { initSchema, initVecSchema } from './schema.js';

let db: Database.Database | null = null;
let vecEnabled = false;

export async function getDb(dbPath: string): Promise<Database.Database> {
  if (db) return db;
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);

  // 尝试加载 sqlite-vec
  try {
    const sqliteVec = await import('sqlite-vec');
    sqliteVec.load(db);
    vecEnabled = initVecSchema(db);
  } catch {
    vecEnabled = false;
  }

  return db;
}

export function isVecEnabled(): boolean {
  return vecEnabled;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    vecEnabled = false;
  }
}
