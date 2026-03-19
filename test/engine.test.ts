import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from '../src/db/schema.js';
import { initTraitsIfNeeded, getTraits } from '../src/persona/traits.js';
import { initStateIfNeeded, getState } from '../src/persona/states.js';
import { getRelationship } from '../src/persona/relationship.js';
import { evolve } from '../src/persona/engine.js';
import { recordMessage, getMessageCount } from '../src/memory/store.js';
import { recall } from '../src/memory/retrieval.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  initSchema(db);
});

afterEach(() => {
  db.close();
});

describe('演化引擎集成测试', () => {
  it('initializes traits and state with defaults', () => {
    const traits = initTraitsIfNeeded(db);
    const state = initStateIfNeeded(db);

    expect(traits.openness).toBe(0.7);
    expect(traits.version).toBe(1);
    expect(state.pleasure).toBe(0.2);
  });

  it('evolves state based on positive messages', async () => {
    initTraitsIfNeeded(db);
    initStateIfNeeded(db);

    const stateBefore = getState(db)!;
    const messages = [
      { role: 'user', content: '太棒了！谢谢你，做得非常好！' },
      { role: 'user', content: '完美，我很满意，你真厉害！' },
      { role: 'user', content: '太好了，继续保持！赞！' },
    ];

    const result = await evolve(db, messages);

    expect(result.analysis.userTone).toBeGreaterThan(0);
    expect(result.analysisMethod).toBe('rules');
    expect(result.newState.pleasure).toBeGreaterThanOrEqual(stateBefore.pleasure);
  });

  it('evolves state based on negative messages', async () => {
    initTraitsIfNeeded(db);
    initStateIfNeeded(db);

    const messages = [
      { role: 'user', content: '这个不行，太差了' },
      { role: 'user', content: '失败了，我很失望，太糟糕了' },
      { role: 'user', content: '错误太多了，烦死了' },
    ];

    const result = await evolve(db, messages);

    expect(result.analysis.userTone).toBeLessThan(0);
    expect(result.analysis.suggestedStateDelta.pleasure).toBeLessThan(0);
  });

  it('records evolution history', async () => {
    initTraitsIfNeeded(db);
    initStateIfNeeded(db);

    await evolve(db, [{ role: 'user', content: '你好' }]);

    const history = db.prepare(
      "SELECT * FROM evolution_history WHERE layer = 'state'"
    ).all();
    expect(history.length).toBeGreaterThan(0);
  });

  it('updates relationship on evolve', async () => {
    initTraitsIfNeeded(db);
    initStateIfNeeded(db);

    const relBefore = getRelationship(db);
    await evolve(db, [{ role: 'user', content: '谢谢你，做得很好！' }]);
    const relAfter = getRelationship(db);

    expect(relAfter.totalInteractions).toBe(relBefore.totalInteractions + 1);
  });
});

describe('对话存储与检索', () => {
  it('records and retrieves messages', async () => {
    await recordMessage(db, {
      role: 'user', content: '帮我写一个排序算法',
      platform: 'claude-code', sessionId: 's1', timestamp: Date.now(), metadata: null,
    });
    await recordMessage(db, {
      role: 'assistant', content: '好的，这是一个快速排序的实现...',
      platform: 'claude-code', sessionId: 's1', timestamp: Date.now(), metadata: null,
    });

    expect(getMessageCount(db)).toBe(2);
  });

  it('FTS5 recall finds relevant messages', async () => {
    await recordMessage(db, {
      role: 'user', content: '帮我写一个排序算法',
      platform: 'test', sessionId: null, timestamp: Date.now(), metadata: null,
    });
    await recordMessage(db, {
      role: 'user', content: '今天天气真好',
      platform: 'test', sessionId: null, timestamp: Date.now(), metadata: null,
    });

    const results = await recall(db, '排序');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].message.content).toContain('排序');
  });

  it('recall returns empty for no match', async () => {
    await recordMessage(db, {
      role: 'user', content: '你好',
      platform: 'test', sessionId: null, timestamp: Date.now(), metadata: null,
    });

    const results = await recall(db, 'xyznonexistent');
    expect(results.length).toBe(0);
  });
});
