// ============================================================
// 混合检索：FTS5 关键词 + sqlite-vec 向量语义 + 时间衰减
// ============================================================

import type Database from 'better-sqlite3';
import type { ConversationMessage, LlmConfig } from '../types.js';
import { isVecEnabled } from '../db/connection.js';
import { generateEmbedding, embeddingToBuffer } from './embedding.js';

interface RecallResult {
  message: ConversationMessage;
  relevance: number;
  source: 'fts' | 'vec' | 'like';
}

let embeddingConfig: LlmConfig | null = null;

export function setRecallEmbeddingConfig(config: LlmConfig | null): void {
  embeddingConfig = config;
}

/**
 * 混合检索：
 * 1. FTS5 trigram 关键词匹配
 * 2. sqlite-vec 向量语义相似度
 * 3. LIKE 降级（短查询或前两者无结果）
 * 4. 合并去重 + 时间衰减重排
 */
export async function recall(
  db: Database.Database,
  query: string,
  limit: number = 10,
): Promise<RecallResult[]> {
  const q = query.trim();
  if (!q) return [];

  const candidates = new Map<number, RecallResult>(); // rowid → result
  const now = Date.now();
  const DAY_MS = 86400_000;

  // 1. FTS5 检索（trigram 需要 >= 3 字符）
  if (q.length >= 3) {
    try {
      const rows = db.prepare(`
        SELECT
          c.rowid, c.id, c.platform, c.session_id, c.role, c.content, c.timestamp, c.metadata,
          f.rank AS fts_rank
        FROM conversation_fts f
        JOIN conversations c ON c.rowid = f.rowid
        WHERE conversation_fts MATCH ?
        ORDER BY f.rank
        LIMIT ?
      `).all(q, limit * 2) as any[];

      for (const row of rows) {
        const age = (now - row.timestamp) / DAY_MS;
        const timeDecay = Math.exp(-0.023 * age);
        const textRelevance = 1 / (1 + Math.abs(row.fts_rank));
        const relevance = textRelevance * 0.5 + timeDecay * 0.3;

        candidates.set(row.rowid, {
          message: rowToMessage(row),
          relevance,
          source: 'fts',
        });
      }
    } catch {
      // FTS 查询语法错误，跳过
    }
  }

  // 2. 向量语义检索
  if (isVecEnabled()) {
    try {
      const queryEmbedding = await generateEmbedding(q, embeddingConfig);
      const queryBuf = embeddingToBuffer(queryEmbedding);

      const rows = db.prepare(`
        SELECT v.rowid, v.distance,
          c.id, c.platform, c.session_id, c.role, c.content, c.timestamp, c.metadata
        FROM conversation_vec v
        JOIN conversations c ON c.rowid = v.rowid
        WHERE embedding MATCH ? AND k = ?
        ORDER BY distance
      `).all(queryBuf, limit * 2) as any[];

      for (const row of rows) {
        const age = (now - row.timestamp) / DAY_MS;
        const timeDecay = Math.exp(-0.023 * age);
        // distance 越小越相似，转换为相似度
        const similarity = 1 / (1 + row.distance);
        const relevance = similarity * 0.5 + timeDecay * 0.3;

        const existing = candidates.get(row.rowid);
        if (existing) {
          // 两个来源都命中，boost 分数
          existing.relevance = Math.max(existing.relevance, relevance) + 0.2;
        } else {
          candidates.set(row.rowid, {
            message: rowToMessage(row),
            relevance,
            source: 'vec',
          });
        }
      }
    } catch {
      // 向量检索失败，跳过
    }
  }

  // 3. LIKE 降级（前面没结果时）
  if (candidates.size === 0) {
    const rows = db.prepare(`
      SELECT rowid, id, platform, session_id, role, content, timestamp, metadata
      FROM conversations
      WHERE content LIKE ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(`%${q}%`, limit * 2) as any[];

    for (const row of rows) {
      const age = (now - row.timestamp) / DAY_MS;
      const timeDecay = Math.exp(-0.023 * age);
      const relevance = 0.4 + timeDecay * 0.3;

      candidates.set(row.rowid, {
        message: rowToMessage(row),
        relevance,
        source: 'like',
      });
    }
  }

  // 排序取 top N
  const results = Array.from(candidates.values());
  results.sort((a, b) => b.relevance - a.relevance);
  return results.slice(0, limit);
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
