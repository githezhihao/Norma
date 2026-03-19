import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { initSchema, initVecSchema } from '../src/db/schema.js';
import { generateEmbedding, embeddingToBuffer, EMBEDDING_DIM } from '../src/memory/embedding.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  initSchema(db);
  sqliteVec.load(db);
  initVecSchema(db);
});

afterEach(() => {
  db.close();
});

describe('本地 embedding 生成', () => {
  it('generates fixed-dimension vectors', async () => {
    const vec = await generateEmbedding('你好世界', null);
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(EMBEDDING_DIM);
  });

  it('generates normalized vectors (L2 norm ≈ 1)', async () => {
    const vec = await generateEmbedding('这是一段测试文本', null);
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    expect(Math.sqrt(norm)).toBeCloseTo(1.0, 1);
  });

  it('similar texts produce similar vectors', async () => {
    const v1 = await generateEmbedding('帮我写一个排序算法', null);
    const v2 = await generateEmbedding('帮我写一个排序函数', null);
    const v3 = await generateEmbedding('今天天气真好', null);

    const sim12 = cosine(v1, v2);
    const sim13 = cosine(v1, v3);

    // 相似文本的余弦相似度应该更高
    expect(sim12).toBeGreaterThan(sim13);
  });
});

describe('sqlite-vec 向量存储与检索', () => {
  it('stores and retrieves vectors by KNN', async () => {
    // 插入几条消息和对应的向量
    const texts = [
      '帮我写一个排序算法',
      '今天天气真好',
      '快速排序的时间复杂度是多少',
    ];

    for (let i = 0; i < texts.length; i++) {
      const result = db.prepare('INSERT INTO conversations (id, platform, role, content, timestamp) VALUES (?, ?, ?, ?, ?)')
        .run(`id-${i}`, 'test', 'user', texts[i], Date.now());

      const rowid = BigInt(result.lastInsertRowid);
      const vec = await generateEmbedding(texts[i], null);
      db.prepare('INSERT INTO conversation_vec(rowid, embedding) VALUES (?, ?)')
        .run(rowid, embeddingToBuffer(vec));
    }

    // 查询 "排序" 相关
    const queryVec = await generateEmbedding('排序算法', null);
    const results = db.prepare(`
      SELECT v.rowid, v.distance, c.content
      FROM conversation_vec v
      JOIN conversations c ON c.rowid = v.rowid
      WHERE embedding MATCH ? AND k = 3
      ORDER BY distance
    `).all(embeddingToBuffer(queryVec)) as any[];

    expect(results.length).toBe(3);
    // 最相似的应该是 "排序算法" 或 "快速排序"
    expect(results[0].content).toMatch(/排序/);
  });
});

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}
