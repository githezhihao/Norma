import type Database from 'better-sqlite3';
import { EMBEDDING_DIM } from '../memory/embedding.js';

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      platform TEXT NOT NULL,
      session_id TEXT,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      metadata TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_conv_time ON conversations(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_conv_platform ON conversations(platform, timestamp DESC);

    CREATE TABLE IF NOT EXISTS persona_traits (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      openness REAL NOT NULL,
      conscientiousness REAL NOT NULL,
      extraversion REAL NOT NULL,
      agreeableness REAL NOT NULL,
      neuroticism REAL NOT NULL,
      baseline_o REAL NOT NULL,
      baseline_c REAL NOT NULL,
      baseline_e REAL NOT NULL,
      baseline_a REAL NOT NULL,
      baseline_n REAL NOT NULL,
      personality_name TEXT,
      personality_desc TEXT,
      updated_at INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS persona_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      pleasure REAL NOT NULL DEFAULT 0.2,
      arousal REAL NOT NULL DEFAULT 0,
      dominance REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evolution_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      layer TEXT NOT NULL CHECK (layer IN ('trait', 'state')),
      values_json TEXT NOT NULL,
      trigger_type TEXT NOT NULL CHECK (trigger_type IN ('conversation', 'manual', 'decay')),
      trigger_summary TEXT,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_evo_time ON evolution_history(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_evo_layer ON evolution_history(layer, timestamp DESC);

    CREATE TABLE IF NOT EXISTS relationship (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      avg_tone REAL NOT NULL DEFAULT 0,
      conflict_frequency REAL NOT NULL DEFAULT 0,
      trust_level REAL NOT NULL DEFAULT 0.5,
      interaction_style TEXT NOT NULL DEFAULT 'casual',
      total_interactions INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
  `);

  // FTS5 虚拟表需要单独创建（不支持 IF NOT EXISTS 语法一致性）
  const ftsExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_fts'"
  ).get();

  if (!ftsExists) {
    db.exec(`
      CREATE VIRTUAL TABLE conversation_fts USING fts5(
        content,
        role,
        content='conversations',
        content_rowid='rowid',
        tokenize='trigram'
      );

      CREATE TRIGGER IF NOT EXISTS conversations_ai AFTER INSERT ON conversations BEGIN
        INSERT INTO conversation_fts(rowid, content, role)
        VALUES (new.rowid, new.content, new.role);
      END;

      CREATE TRIGGER IF NOT EXISTS conversations_ad AFTER DELETE ON conversations BEGIN
        INSERT INTO conversation_fts(conversation_fts, rowid, content, role)
        VALUES ('delete', old.rowid, old.content, old.role);
      END;

      CREATE TRIGGER IF NOT EXISTS conversations_au AFTER UPDATE ON conversations BEGIN
        INSERT INTO conversation_fts(conversation_fts, rowid, content, role)
        VALUES ('delete', old.rowid, old.content, old.role);
        INSERT INTO conversation_fts(rowid, content, role)
        VALUES (new.rowid, new.content, new.role);
      END;
    `);
  }
}

/**
 * 初始化 sqlite-vec 向量表（需要先 load 扩展）
 * 单独调用，因为 sqlite-vec 可能加载失败
 */
export function initVecSchema(db: Database.Database): boolean {
  try {
    const vecExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_vec'"
    ).get();

    if (!vecExists) {
      db.exec(`CREATE VIRTUAL TABLE conversation_vec USING vec0(embedding float[${EMBEDDING_DIM}])`);
    }
    return true;
  } catch {
    return false;
  }
}
