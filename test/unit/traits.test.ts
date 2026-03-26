import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  initTraitsIfNeeded,
  getTraits,
  upsertTraits,
  updateTraitValues,
} from '@/persona/traits.js';
import { initSchema } from '@/db/schema.js';
import { DEFAULT_OCEAN } from '@/types.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  initSchema(db);
  return db;
}

describe('initTraitsIfNeeded', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('首次初始化使用默认值', () => {
    const result = initTraitsIfNeeded(db);

    expect(result.openness).toBe(DEFAULT_OCEAN.openness);
    expect(result.conscientiousness).toBe(DEFAULT_OCEAN.conscientiousness);
    expect(result.extraversion).toBe(DEFAULT_OCEAN.extraversion);
    expect(result.agreeableness).toBe(DEFAULT_OCEAN.agreeableness);
    expect(result.neuroticism).toBe(DEFAULT_OCEAN.neuroticism);
    expect(result.version).toBe(1);
  });

  it('支持自定义初始值', () => {
    const result = initTraitsIfNeeded(db, {
      openness: 0.9,
      neuroticism: 0.1,
    }, '测试人格', '这是一个测试人格');

    expect(result.openness).toBe(0.9);
    expect(result.neuroticism).toBe(0.1);
    expect(result.personalityName).toBe('测试人格');
    expect(result.personalityDesc).toBe('这是一个测试人格');
  });

  it('重复调用返回已有记录', () => {
    const first = initTraitsIfNeeded(db, { openness: 0.8 });
    const second = initTraitsIfNeeded(db, { openness: 0.9 });

    expect(first.openness).toBe(0.8);
    expect(second.openness).toBe(0.8); // 不会更新
    expect(second.version).toBe(first.version);
  });
});

describe('getTraits', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('无记录时返回 null', () => {
    const result = getTraits(db);
    expect(result).toBeNull();
  });

  it('返回完整的人格特质', () => {
    db.prepare(`
      INSERT INTO persona_traits (id, openness, conscientiousness, extraversion, agreeableness, neuroticism,
        baseline_o, baseline_c, baseline_e, baseline_a, baseline_n,
        personality_name, personality_desc, updated_at, version)
      VALUES (1, 0.8, 0.7, 0.6, 0.5, 0.4, 0.7, 0.7, 0.5, 0.5, 0.3, '测试', '描述', ?, 2)
    `).run(Date.now());

    const result = getTraits(db);

    expect(result).not.toBeNull();
    expect(result?.openness).toBe(0.8);
    expect(result?.conscientiousness).toBe(0.7);
    expect(result?.extraversion).toBe(0.6);
    expect(result?.agreeableness).toBe(0.5);
    expect(result?.neuroticism).toBe(0.4);
    expect(result?.baseline.openness).toBe(0.7);
    expect(result?.personalityName).toBe('测试');
    expect(result?.version).toBe(2);
  });
});

describe('upsertTraits', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('新建特质记录', () => {
    const traits = {
      openness: 0.8,
      conscientiousness: 0.7,
      extraversion: 0.6,
      agreeableness: 0.5,
      neuroticism: 0.4,
    };
    const result = upsertTraits(db, traits, traits, '新人格', '新描述');

    expect(result.openness).toBe(0.8);
    expect(result.personalityName).toBe('新人格');
    expect(result.version).toBe(1);
  });

  it('更新现有特质', () => {
    // 先创建记录
    const initial = {
      openness: 0.5,
      conscientiousness: 0.5,
      extraversion: 0.5,
      agreeableness: 0.5,
      neuroticism: 0.5,
    };
    upsertTraits(db, initial, initial, '初始', '初始描述');

    // 更新
    const updated = {
      openness: 0.9,
      conscientiousness: 0.8,
      extraversion: 0.7,
      agreeableness: 0.6,
      neuroticism: 0.5,
    };
    const result = upsertTraits(db, updated, updated, '更新后', '更新描述');

    expect(result.openness).toBe(0.9);
    expect(result.conscientiousness).toBe(0.8);
    expect(result.version).toBe(2);
    expect(result.personalityName).toBe('更新后');
  });

  it('每次更新版本号递增', () => {
    const traits = { ...DEFAULT_OCEAN };
    upsertTraits(db, traits, traits);
    upsertTraits(db, traits, traits);
    const result = upsertTraits(db, traits, traits);

    expect(result.version).toBe(3);
  });
});

describe('updateTraitValues', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    // 先初始化记录
    const traits = { ...DEFAULT_OCEAN };
    upsertTraits(db, traits, traits);
  });

  it('仅更新特质值不更新 baseline', () => {
    const initial = getTraits(db);
    const updated = {
      openness: 0.9,
      conscientiousness: 0.8,
      extraversion: 0.7,
      agreeableness: 0.6,
      neuroticism: 0.5,
    };
    updateTraitValues(db, updated);

    const result = getTraits(db);
    expect(result?.openness).toBe(0.9);
    expect(result?.baseline.openness).toBe(initial?.baseline.openness); // baseline 不变
    expect(result?.version).toBe(initial!.version + 1);
  });

  it('更新时间戳', () => {
    const before = getTraits(db);
    updateTraitValues(db, { ...DEFAULT_OCEAN });
    const after = getTraits(db);

    expect(after!.updatedAt).toBeGreaterThanOrEqual(before!.updatedAt);
  });
});
