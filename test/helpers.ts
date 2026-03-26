// ============================================================
// 测试辅助工具
// ============================================================

import Database from 'better-sqlite3';
import { initSchema } from '@/db/schema.js';
import type { OceanTraits, PadState } from '@/types.js';
import { EMBEDDING_DIM } from '@/memory/embedding.js';

/**
 * 创建内存测试数据库（已初始化 schema）
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  initSchema(db);
  return db;
}

/**
 * 关闭并清理数据库
 */
export function cleanupDb(db: Database.Database): void {
  db.close();
}

/**
 * 默认测试用 Traits
 */
export const DEFAULT_TEST_TRAITS: OceanTraits = {
  openness: 0.7,
  conscientiousness: 0.7,
  extraversion: 0.5,
  agreeableness: 0.7,
  neuroticism: 0.3,
};

/**
 * 默认测试用 State
 */
export const DEFAULT_TEST_STATE: PadState = {
  pleasure: 0.2,
  arousal: 0.0,
  dominance: 0.0,
};

/**
 * Mock embedding 生成（确定性哈希，方便测试）
 */
export function mockEmbedding(text: string): Float32Array {
  const vec = new Float32Array(EMBEDDING_DIM);
  for (let i = 0; i < text.length; i++) {
    const idx = text.charCodeAt(i) % EMBEDDING_DIM;
    vec[idx] += 0.1;
  }
  // L2 归一化
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMBEDDING_DIM; i++) vec[i] /= norm;
  return vec;
}

/**
 * 将 Float32Array 转为 Buffer（用于插入 DB）
 */
export function floatToBuffer(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

/**
 * 断言辅助：数值接近（考虑浮点误差）
 */
export function closeTo(actual: number, expected: number, tolerance: number = 0.001): boolean {
  return Math.abs(actual - expected) < tolerance;
}
