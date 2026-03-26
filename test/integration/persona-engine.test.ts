import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PersonaEngine } from '@/core/persona-engine.js';
import { DEFAULT_OCEAN, DEFAULT_PAD } from '@/types.js';

function createTestDbPath(): string {
  const id = Math.random().toString(36).slice(2, 9);
  return join(tmpdir(), `persona-test-${id}.db`);
}

function cleanupDb(path: string): void {
  try {
    rmSync(path);
    rmSync(path + '-wal');
    rmSync(path + '-shm');
  } catch {
    // 文件可能不存在，忽略
  }
}

describe('PersonaEngine 初始化', () => {
  let engine: PersonaEngine;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = createTestDbPath();
    engine = new PersonaEngine(dbPath);
    await engine.initVec();
  });

  afterEach(() => {
    engine.close();
    cleanupDb(dbPath);
  });

  it('成功创建引擎实例', () => {
    expect(engine).toBeDefined();
    expect(engine.getMessageCount()).toBe(0);
  });

  it('sqlite-vec 可选启用', () => {
    // 测试环境可能无法加载 vec，但不应该崩溃
    const vecEnabled = engine.isVecEnabled();
    expect(typeof vecEnabled).toBe('boolean');
  });
});

describe('PersonaEngine 人格管理', () => {
  let engine: PersonaEngine;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = createTestDbPath();
    engine = new PersonaEngine(dbPath);
    await engine.initVec();
  });

  afterEach(() => {
    engine.close();
    cleanupDb(dbPath);
  });

  it('初始化人格', () => {
    const traits = engine.initPersona('小云', '可爱的 AI 妹妹', {
      openness: 0.8,
      extraversion: 0.6,
    });

    expect(traits.personalityName).toBe('小云');
    expect(traits.personalityDesc).toBe('可爱的 AI 妹妹');
    expect(traits.openness).toBe(0.8);
    expect(traits.extraversion).toBe(0.6);
    expect(traits.version).toBe(1);
  });

  it('获取人格特质', () => {
    engine.initPersona('测试', '测试人格');
    const traits = engine.getTraits();

    expect(traits).not.toBeNull();
    expect(traits?.personalityName).toBe('测试');
  });

  it('获取情绪状态', () => {
    engine.initPersona();
    const state = engine.getState();

    expect(state).not.toBeNull();
    expect(state?.pleasure).toBe(DEFAULT_PAD.pleasure);
  });

  it('获取关系模式', () => {
    engine.initPersona();
    const relationship = engine.getRelationship();

    expect(relationship.trustLevel).toBe(0.5);
    expect(relationship.totalInteractions).toBe(0);
  });
});

describe('PersonaEngine 消息记录', () => {
  let engine: PersonaEngine;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = createTestDbPath();
    engine = new PersonaEngine(dbPath);
    await engine.initVec();
    engine.initPersona();
  });

  afterEach(() => {
    engine.close();
    cleanupDb(dbPath);
  });

  it('记录单条消息', async () => {
    const msg = {
      role: 'user' as const,
      content: '你好，小云！',
      platform: 'claude-code',
      sessionId: 'test-session',
    };

    const result = await engine.recordMessage(msg);

    expect(result.content).toBe('你好，小云！');
    expect(engine.getMessageCount()).toBe(1);
  });

  it('记录多条消息', async () => {
    await engine.recordMessage({
      role: 'user',
      content: '消息 1',
      platform: 'claude-code',
    });
    await engine.recordMessage({
      role: 'assistant',
      content: '回复 1',
      platform: 'claude-code',
    });
    await engine.recordMessage({
      role: 'user',
      content: '消息 2',
      platform: 'claude-code',
    });

    expect(engine.getMessageCount()).toBe(3);
  });

  it('获取最近消息', async () => {
    // 先清空数据库，避免之前测试的消息干扰
    engine.getDb().exec('DELETE FROM conversations');

    const now = Date.now();
    await engine.recordMessage({ role: 'user', content: '消息 1', platform: 'test', timestamp: now - 2000 });
    await engine.recordMessage({ role: 'assistant', content: '回复 1', platform: 'test', timestamp: now - 1000 });
    await engine.recordMessage({ role: 'user', content: '消息 2', platform: 'test', timestamp: now });

    const messages = engine.getRecentMessages(2);

    // getRecentMessages 返回的是 DESC 排序后 reverse，即最旧在前
    // 插入顺序：消息 1 → 回复 1 → 消息 2
    // DESC: [消息 2, 回复 1] (最新的 2 条)
    // reverse 后：[回复 1, 消息 2]
    expect(messages.length).toBe(2);
    expect(messages[0].content).toBe('回复 1');
    expect(messages[1].content).toBe('消息 2');
  });

  it('获取最近用户消息', async () => {
    // 先清空数据库，避免之前测试的消息干扰
    engine.getDb().exec('DELETE FROM conversations');

    const now = Date.now();
    await engine.recordMessage({ role: 'user', content: '用户 1', platform: 'test', timestamp: now - 2000 });
    await engine.recordMessage({ role: 'assistant', content: '回复', platform: 'test', timestamp: now - 1000 });
    await engine.recordMessage({ role: 'user', content: '用户 2', platform: 'test', timestamp: now });

    const userMessages = engine.getRecentUserMessages(5);

    // getRecentUserMessages 返回的是 DESC 排序后 reverse，即最旧在前
    // 插入顺序：用户 1 → 回复 → 用户 2
    // DESC: [用户 2, 回复，用户 1]
    // reverse 后：[用户 1, 回复，用户 2]
    expect(userMessages.length).toBe(3);
    expect(userMessages[0].content).toBe('用户 1');
    expect(userMessages[1].content).toBe('回复');
    expect(userMessages[2].content).toBe('用户 2');
  });
});

describe('PersonaEngine 记忆检索', () => {
  let engine: PersonaEngine;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = createTestDbPath();
    engine = new PersonaEngine(dbPath);
    await engine.initVec();
    engine.initPersona();
  });

  afterEach(() => {
    engine.close();
    cleanupDb(dbPath);
  });

  it('空查询返回空结果', async () => {
    const results = await engine.recall('');
    expect(results).toEqual([]);
  });

  it('LIKE 降级检索', async () => {
    await engine.recordMessage({
      role: 'user',
      content: '今天天气真好，适合出去散步',
      platform: 'test',
    });
    await engine.recordMessage({
      role: 'assistant',
      content: '老大说得对！散步对身体好~',
      platform: 'test',
    });

    // 向量未启用时用 LIKE
    const results = await engine.recall('天气');

    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.message.content.includes('天气'))).toBe(true);
  });

  it('检索结果包含相关性评分', async () => {
    await engine.recordMessage({
      role: 'user',
      content: '测试内容',
      platform: 'test',
    });

    const results = await engine.recall('测试');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].relevance).toBeGreaterThan(0);
    expect(results[0].source).toBeDefined();
  });
});

describe('PersonaEngine 配置管理', () => {
  let engine: PersonaEngine;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = createTestDbPath();
    engine = new PersonaEngine(dbPath);
    await engine.initVec();
  });

  afterEach(() => {
    engine.close();
    cleanupDb(dbPath);
  });

  it('获取默认配置', () => {
    const config = engine.getConfig();

    expect(config.emotionalInertia).toBe(0.6);
    expect(config.negativityBias).toBe(2.5);
    expect(config.stateDecayRate).toBe(0.03);
    expect(config.traitDecayRate).toBe(0.002);
  });

  it('更新配置', () => {
    engine.updateConfig({
      emotionalInertia: 0.8,
      negativityBias: 3.0,
    });

    const config = engine.getConfig();
    expect(config.emotionalInertia).toBe(0.8);
    expect(config.negativityBias).toBe(3.0);
    // 未更新的配置保持默认
    expect(config.stateDecayRate).toBe(0.03);
  });

  it('设置 LLM 配置', () => {
    engine.setLlmConfig({
      provider: 'anthropic',
      apiKey: 'test-key',
      model: 'claude-sonnet-4-6',
    });

    const config = engine.getLlmConfig();
    expect(config?.provider).toBe('anthropic');
    expect(config?.apiKey).toBe('test-key');
  });

  it('禁用 LLM', () => {
    engine.setLlmConfig({ provider: 'anthropic', apiKey: 'test' });
    engine.setLlmConfig(null);

    expect(engine.getLlmConfig()).toBeNull();
  });
});

describe('PersonaEngine 指标统计', () => {
  let engine: PersonaEngine;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = createTestDbPath();
    engine = new PersonaEngine(dbPath);
    await engine.initVec();
    engine.initPersona();
  });

  afterEach(() => {
    engine.close();
    cleanupDb(dbPath);
  });

  it('获取引擎指标', async () => {
    await engine.recordMessage({ role: 'user', content: '测试', platform: 'test' });

    const metrics = engine.getMetrics();

    expect(metrics.messageCount).toBe(1);
    expect(metrics.startedAt).toBeDefined();
    expect(metrics.uptimeMs).toBeGreaterThan(0);
    expect(typeof metrics.vecEnabled).toBe('boolean');
  });

  it('获取演化分析', () => {
    const analytics = engine.getEvolutionAnalytics();

    expect(analytics.total).toBe(0);
    expect(analytics.stateCount).toBe(0);
    expect(analytics.traitCount).toBe(0);
  });
});

describe('PersonaEngine 叙事生成', () => {
  let engine: PersonaEngine;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = createTestDbPath();
    engine = new PersonaEngine(dbPath);
    await engine.initVec();
    engine.initPersona('小云', '可爱的 AI 妹妹');
  });

  afterEach(() => {
    engine.close();
    cleanupDb(dbPath);
  });

  it('生成完整状态描述（prompt 格式）', () => {
    const result = engine.narrateState('prompt');

    expect(result).toContain('我是小云');
    expect(result).toContain('### 性格特点');
    expect(result).toContain('### 当前心情');
    expect(result).toContain('### 和老大的羁绊');
  });

  it('生成 JSON 格式状态', () => {
    const result = engine.narrateState('json');

    const parsed = JSON.parse(result);
    expect(parsed.traits).toBeDefined();
    expect(parsed.state).toBeDefined();
    expect(parsed.relationship).toBeDefined();
  });

  it('生成简短状态', () => {
    const result = engine.narrateBrief();

    expect(result.length).toBeLessThan(100);
  });
});

describe('PersonaEngine 演化流程', () => {
  let engine: PersonaEngine;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = createTestDbPath();
    engine = new PersonaEngine(dbPath);
    await engine.initVec();
    engine.initPersona();
  });

  afterEach(() => {
    engine.close();
    cleanupDb(dbPath);
  });

  it('执行演化（规则分析）', async () => {
    const result = await engine.evolve(
      [
        { role: 'user', content: '太棒了！你做得很好！' },
        { role: 'user', content: '继续保持！' },
      ],
      'manual',
    );

    expect(result.analysisMethod).toBe('rules');
    expect(result.previousState).toBeDefined();
    expect(result.newState).toBeDefined();
    expect(result.traitChanged).toBe(false); // 单次演化不会改变 trait
  });

  it('基线回归（decay）', () => {
    const newState = engine.decayState();

    expect(newState).toBeDefined();
    expect(newState.pleasure).toBeDefined();
  });

  it('recordAndMaybeEvolve 自动触发', async () => {
    // 设置每 2 条消息触发一次演化
    engine.updateConfig({ evolveEveryN: 2 });

    // 记录 2 条消息应该触发演化
    const result1 = await engine.recordAndMaybeEvolve({
      role: 'user',
      content: '消息 1',
      platform: 'test',
    });
    expect(result1.evolveResult).toBeUndefined(); // 第 1 条不触发

    const result2 = await engine.recordAndMaybeEvolve({
      role: 'user',
      content: '消息 2',
      platform: 'test',
    });
    expect(result2.evolveResult).toBeDefined(); // 第 2 条触发
  });
});

describe('PersonaEngine 历史查询', () => {
  let engine: PersonaEngine;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = createTestDbPath();
    engine = new PersonaEngine(dbPath);
    await engine.initVec();
    engine.initPersona();
  });

  afterEach(() => {
    engine.close();
    cleanupDb(dbPath);
  });

  it('获取演化历史（空）', () => {
    const history = engine.getHistory('all', 10);
    expect(history).toEqual([]);
  });

  it('获取 state 历史', async () => {
    await engine.evolve([{ role: 'user', content: '测试' }], 'manual');

    const history = engine.getHistory('state', 10);
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].layer).toBe('state');
  });

  it('获取 trait 历史', async () => {
    const history = engine.getHistory('trait', 10);
    expect(history).toEqual([]); // 初始无 trait 演化
  });
});
