import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  initStateIfNeeded,
  getState,
  upsertState,
} from '@/persona/states.js';
import { initSchema } from '@/db/schema.js';
import { DEFAULT_PAD } from '@/types.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  initSchema(db);
  return db;
}

describe('initStateIfNeeded', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('首次初始化使用默认值', () => {
    const result = initStateIfNeeded(db);

    expect(result.pleasure).toBe(DEFAULT_PAD.pleasure);
    expect(result.arousal).toBe(DEFAULT_PAD.arousal);
    expect(result.dominance).toBe(DEFAULT_PAD.dominance);
  });

  it('支持自定义初始值', () => {
    const result = initStateIfNeeded(db, {
      pleasure: 0.5,
      arousal: 0.3,
      dominance: -0.2,
    });

    expect(result.pleasure).toBe(0.5);
    expect(result.arousal).toBe(0.3);
    expect(result.dominance).toBe(-0.2);
  });

  it('重复调用返回已有记录', () => {
    const first = initStateIfNeeded(db, { pleasure: 0.8 });
    const second = initStateIfNeeded(db, { pleasure: -0.5 });

    expect(first.pleasure).toBe(0.8);
    expect(second.pleasure).toBe(0.8); // 不会更新
  });
});

describe('getState', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('无记录时返回 null', () => {
    const result = getState(db);
    expect(result).toBeNull();
  });

  it('返回完整的情绪状态', () => {
    db.prepare(`
      INSERT INTO persona_state (id, pleasure, arousal, dominance, updated_at)
      VALUES (1, 0.6, -0.3, 0.2, ?)
    `).run(Date.now());

    const result = getState(db);

    expect(result).not.toBeNull();
    expect(result?.pleasure).toBe(0.6);
    expect(result?.arousal).toBe(-0.3);
    expect(result?.dominance).toBe(0.2);
  });
});

describe('upsertState', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('新建状态记录', () => {
    const state = {
      pleasure: 0.5,
      arousal: -0.2,
      dominance: 0.3,
    };
    const result = upsertState(db, state);

    expect(result.pleasure).toBe(0.5);
    expect(result.arousal).toBe(-0.2);
    expect(result.dominance).toBe(0.3);
  });

  it('更新现有状态', () => {
    // 先创建记录
    const initial = {
      pleasure: 0.2,
      arousal: 0.0,
      dominance: 0.0,
    };
    upsertState(db, initial);

    // 更新
    const updated = {
      pleasure: 0.8,
      arousal: 0.5,
      dominance: -0.3,
    };
    const result = upsertState(db, updated);

    expect(result.pleasure).toBe(0.8);
    expect(result.arousal).toBe(0.5);
    expect(result.dominance).toBe(-0.3);
  });

  it('更新时间戳', () => {
    const before = upsertState(db, { pleasure: 0.2, arousal: 0, dominance: 0 });
    const after = upsertState(db, { pleasure: 0.5, arousal: 0.1, dominance: 0 });

    expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
  });
});
