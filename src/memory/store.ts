// ============================================================
// 对话存储（含向量 embedding）
// ============================================================

import type Database from 'better-sqlite3';
import type { ConversationMessage, LlmConfig } from '../types.js';
import { randomUUID } from 'node:crypto';
import { isVecEnabled } from '../db/connection.js';
import { generateEmbedding, embeddingToBuffer } from './embedding.js';

let embeddingConfig: LlmConfig | null = null;

export function setEmbeddingConfig(config: LlmConfig | null): void {
  embeddingConfig = config;
}

export async function recordMessage(
  db: Database.Database,
  msg: Omit<ConversationMessage, 'id'>,
): Promise<ConversationMessage> {
  const id = randomUUID();
  const result = db.prepare(`
    INSERT INTO conversations (id, platform, session_id, role, content, timestamp, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, msg.platform, msg.sessionId ?? null, msg.role, msg.content,
    msg.timestamp, msg.metadata ? JSON.stringify(msg.metadata) : null,
  );

  // 异步写入向量（不阻塞主流程）
  if (isVecEnabled()) {
    const rowid = BigInt(result.lastInsertRowid);
    try {
      const embedding = await generateEmbedding(msg.content, embeddingConfig);
      db.prepare('INSERT INTO conversation_vec(rowid, embedding) VALUES (?, ?)').run(
        rowid, embeddingToBuffer(embedding),
      );
    } catch {
      // 向量写入失败不影响主流程
    }
  }

  return { id, ...msg };
}

export function getRecentMessages(
  db: Database.Database,
  limit: number = 20,
  platform?: string,
): ConversationMessage[] {
  const sql = platform
    ? 'SELECT * FROM conversations WHERE platform = ? ORDER BY timestamp DESC LIMIT ?'
    : 'SELECT * FROM conversations ORDER BY timestamp DESC LIMIT ?';
  const params = platform ? [platform, limit] : [limit];
  const rows = db.prepare(sql).all(...params) as any[];
  return rows.reverse().map(rowToMessage);
}

export function getMessageCount(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM conversations').get() as any;
  return row.cnt;
}

export function getRecentUserMessages(
  db: Database.Database,
  limit: number,
): Array<{ role: string; content: string }> {
  const rows = db.prepare(`
    SELECT role, content FROM conversations
    ORDER BY timestamp DESC LIMIT ?
  `).all(limit) as Array<{ role: string; content: string }>;
  return rows.reverse();
}

function rowToMessage(row: any): ConversationMessage {
  return {
    id: row.id,
    platform: row.platform,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  };
}
