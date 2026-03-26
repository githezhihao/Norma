import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { getRelationship, updateRelationship } from '@/persona/relationship.js';
import { initSchema } from '@/db/schema.js';
import type { SentimentAnalysis } from '@/types.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  initSchema(db);
  return db;
}

const createMockAnalysis = (overrides?: Partial<SentimentAnalysis>): SentimentAnalysis => ({
  userTone: 0.3,
  emotionalIntensity: 0.5,
  dominanceShift: 0.1,
  topicSentiment: 'positive',
  interactionQuality: 'supportive',
  notableEvents: ['用户表达了感谢'],
  suggestedStateDelta: { pleasure: 0.1, arousal: 0.05, dominance: 0.02 },
  ...overrides,
});

describe('getRelationship', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('返回默认关系（无记录时）', () => {
    const result = getRelationship(db);

    expect(result.avgTone).toBe(0);
    expect(result.conflictFrequency).toBe(0);
    expect(result.trustLevel).toBe(0.5);
    expect(result.interactionStyle).toBe('casual');
    expect(result.totalInteractions).toBe(0);
  });

  it('返回已保存的关系', () => {
    db.prepare(`
      INSERT INTO relationship (id, avg_tone, conflict_frequency, trust_level, interaction_style, total_interactions, updated_at)
      VALUES (1, 0.5, 0.2, 0.8, 'playful', 100, ?)
    `).run(Date.now());

    const result = getRelationship(db);

    expect(result.avgTone).toBe(0.5);
    expect(result.conflictFrequency).toBe(0.2);
    expect(result.trustLevel).toBe(0.8);
    expect(result.interactionStyle).toBe('playful');
    expect(result.totalInteractions).toBe(100);
  });
});

describe('updateRelationship', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('首次互动初始化关系', () => {
    const analysis = createMockAnalysis({ userTone: 0.5 });
    const result = updateRelationship(db, analysis);

    expect(result.totalInteractions).toBe(1);
    expect(result.avgTone).toBe(0.5);
    expect(result.trustLevel).toBeCloseTo(0.51, 2);  // 0.5 + 0.01 = 0.51
  });

  it('滑动平均更新语气', () => {
    // 先创建已有记录
    db.prepare(`
      INSERT INTO relationship (id, avg_tone, conflict_frequency, trust_level, interaction_style, total_interactions, updated_at)
      VALUES (1, 0.4, 0.1, 0.6, 'casual', 10, ?)
    `).run(Date.now());

    const analysis = createMockAnalysis({ userTone: 0.8 });
    const result = updateRelationship(db, analysis);

    // (0.4 * 10 + 0.8) / 11 = 4.8 / 11 ≈ 0.436
    expect(result.avgTone).toBeCloseTo(0.436, 3);
    expect(result.totalInteractions).toBe(11);
  });

  it('支持性互动增加信任', () => {
    db.prepare(`
      INSERT INTO relationship (id, avg_tone, conflict_frequency, trust_level, interaction_style, total_interactions, updated_at)
      VALUES (1, 0.3, 0.1, 0.5, 'casual', 5, ?)
    `).run(Date.now());

    const analysis = createMockAnalysis({ interactionQuality: 'supportive' });
    const result = updateRelationship(db, analysis);

    expect(result.trustLevel).toBeGreaterThan(0.5);
  });

  it('冲突出动降低信任', () => {
    db.prepare(`
      INSERT INTO relationship (id, avg_tone, conflict_frequency, trust_level, interaction_style, total_interactions, updated_at)
      VALUES (1, 0.1, 0.1, 0.6, 'casual', 10, ?)
    `).run(Date.now());

    const analysis = createMockAnalysis({
      interactionQuality: 'conflictual',
      userTone: -0.5,
    });
    const result = updateRelationship(db, analysis);

    expect(result.trustLevel).toBeLessThan(0.6);
  });

  it('冲突频率指数移动平均', () => {
    db.prepare(`
      INSERT INTO relationship (id, avg_tone, conflict_frequency, trust_level, interaction_style, total_interactions, updated_at)
      VALUES (1, 0.3, 0.0, 0.5, 'casual', 5, ?)
    `).run(Date.now());

    // 发生冲突
    const conflictAnalysis = createMockAnalysis({ interactionQuality: 'conflictual' });
    updateRelationship(db, conflictAnalysis);

    const result = getRelationship(db);
    // 0.0 * 0.9 + 1 * 0.1 = 0.1
    expect(result.conflictFrequency).toBeCloseTo(0.1, 3);
  });

  it('高冲突频率推断为 demanding 风格', () => {
    db.prepare(`
      INSERT INTO relationship (id, avg_tone, conflict_frequency, trust_level, interaction_style, total_interactions, updated_at)
      VALUES (1, 0.1, 0.5, 0.5, 'casual', 10, ?)
    `).run(Date.now());

    const analysis = createMockAnalysis({ interactionQuality: 'tense' });
    const result = updateRelationship(db, analysis);

    expect(result.interactionStyle).toBe('demanding');
  });

  it('高语气高情绪强度推断为 playful 风格', () => {
    db.prepare(`
      INSERT INTO relationship (id, avg_tone, conflict_frequency, trust_level, interaction_style, total_interactions, updated_at)
      VALUES (1, 0.5, 0.05, 0.6, 'casual', 10, ?)
    `).run(Date.now());

    const analysis = createMockAnalysis({
      userTone: 0.6,
      emotionalIntensity: 0.7,
      interactionQuality: 'supportive',
    });
    const result = updateRelationship(db, analysis);

    expect(result.interactionStyle).toBe('playful');
  });

  it('信任度限制在 [0, 1]', () => {
    // 接近最大值
    db.prepare(`
      INSERT INTO relationship (id, avg_tone, conflict_frequency, trust_level, interaction_style, total_interactions, updated_at)
      VALUES (1, 0.3, 0.1, 0.99, 'casual', 10, ?)
    `).run(Date.now());

    const analysis = createMockAnalysis({ interactionQuality: 'supportive' });
    const result = updateRelationship(db, analysis);

    expect(result.trustLevel).toBeLessThanOrEqual(1);
  });
});
