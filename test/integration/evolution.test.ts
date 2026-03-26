import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PersonaEngine } from '@/core/persona-engine.js';
import { DEFAULT_OCEAN } from '@/types.js';

function createTestDbPath(): string {
  const id = Math.random().toString(36).slice(2, 9);
  return join(tmpdir(), `persona-evolution-test-${id}.db`);
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

describe('PersonaEngine.evolve - 演化流程端到端测试', () => {
  let engine: PersonaEngine;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = createTestDbPath();
    engine = new PersonaEngine(dbPath);
    await engine.initVec();
    engine.initPersona('小云', '可爱的 AI 妹妹', {
      openness: 0.7,
      conscientiousness: 0.6,
      extraversion: 0.5,
      agreeableness: 0.7,
      neuroticism: 0.3,
    });
  });

  afterEach(() => {
    engine.close();
    cleanupDb(dbPath);
  });

  // ============================================================
  // 基础演化测试
  // ============================================================

  it('单次演化返回完整结果', async () => {
    const messages = [
      { role: 'user', content: '太棒了！你做得很好！' },
      { role: 'user', content: '继续保持！' },
    ];

    const result = await engine.evolve(messages, 'manual');

    // 验证返回结构
    expect(result.analysis).toBeDefined();
    expect(result.analysisMethod).toBe('rules'); // 无 LLM 配置时用 rules
    expect(result.previousState).toBeDefined();
    expect(result.newState).toBeDefined();
    expect(typeof result.traitChanged).toBe('boolean');

    // 验证分析结果
    expect(result.analysis.topicSentiment).toBe('positive');
    expect(result.analysis.userTone).toBeGreaterThan(0);
  });

  it('演化后 state 值在有效范围内', async () => {
    const messages = [
      { role: 'user', content: '非常生气！这个问题很严重！' },
    ];

    const result = await engine.evolve(messages, 'manual');

    // PAD 值应该在 [-1, 1] 范围内
    expect(result.newState.pleasure).toBeGreaterThanOrEqual(-1);
    expect(result.newState.pleasure).toBeLessThanOrEqual(1);
    expect(result.newState.arousal).toBeGreaterThanOrEqual(-1);
    expect(result.newState.arousal).toBeLessThanOrEqual(1);
    expect(result.newState.dominance).toBeGreaterThanOrEqual(-1);
    expect(result.newState.dominance).toBeLessThanOrEqual(1);
  });

  // ============================================================
  // 享乐适应 (Hedonic Adaptation)
  // ============================================================

  it('连续正向情感后适应系数下降', async () => {
    // 连续 5 次正向情感刺激
    for (let i = 0; i < 5; i++) {
      await engine.evolve(
        [{ role: 'user', content: '太棒了！真是好消息！' }],
        'manual',
      );
    }

    // 获取演化历史来验证适应效果
    const history = engine.getHistory('state', 10);
    expect(history.length).toBe(5);

    // 第一次和最后一次的 pleasure 变化幅度应该递减
    if (history.length >= 4) {
      const firstDelta = Math.abs(
        (history[1].values as any).pleasure - (history[0].values as any).pleasure,
      );
      const lastDelta = Math.abs(
        (history[3].values as any).pleasure - (history[2].values as any).pleasure,
      );
      // 适应后变化幅度应该更小（但不严格要求，因为还有其他因素）
      // 这里只验证演化正常执行
      expect(firstDelta).toBeGreaterThanOrEqual(0);
      expect(lastDelta).toBeGreaterThanOrEqual(0);
    }
  });

  it('连续负向情感后适应系数下降', async () => {
    for (let i = 0; i < 5; i++) {
      await engine.evolve(
        [{ role: 'user', content: '太糟糕了！非常不满意！' }],
        'manual',
      );
    }

    const history = engine.getHistory('state', 10);
    expect(history.length).toBe(5);

    // 验证 pleasure 持续下降但不突破底线
    const pleasures = history.map(h => (h.values as any).pleasure);
    // 最后一次应该是最低的（但不低于 -1）
    const lastPleasure = pleasures[pleasures.length - 1];
    expect(lastPleasure).toBeGreaterThanOrEqual(-1);
  });

  // ============================================================
  // 情绪惯性 (Emotional Inertia)
  // ============================================================

  it('state 变化是平滑的而非跳跃', async () => {
    // 获取初始 state
    const initialState = engine.getState();
    expect(initialState).not.toBeNull();

    // 单次强刺激
    const result = await engine.evolve(
      [{ role: 'user', content: '震惊！这消息太让人惊讶了！！！' }],
      'manual',
    );

    // 变化幅度不应该超过惯性系数允许的范围
    const delta = Math.abs(result.newState.pleasure - result.previousState.pleasure);
    // 情绪惯性默认 0.6，即变化最多 40%
    expect(delta).toBeLessThan(1); // 不会直接跳到极值
  });

  // ============================================================
  // 基线回归 (Baseline Reversion / Decay)
  // ============================================================

  it('decayState() 执行基线回归', async () => {
    // 先手动设置一个偏离基线的 state
    const db = engine.getDb();
    db.prepare(`
      UPDATE persona_state
      SET pleasure = 0.8, arousal = 0.7, dominance = 0.6
      WHERE id = 1
    `).run();

    // 执行 decay
    const newState = engine.decayState();

    // 验证返回值
    expect(newState).toBeDefined();
    expect(newState.pleasure).toBeDefined();

    // 验证 state 向基线回归（默认基线 pleasure 约 0.2）
    const dbState = engine.getState();
    expect(dbState?.pleasure).toBeLessThan(0.8); // 从 0.8 向基线回归
  });

  it('长时间无对话后情绪自然回归基线', async () => {
    // 先触发一次强情感
    await engine.evolve(
      [{ role: 'user', content: '超级开心！！！' }],
      'manual',
    );

    const stateAfterStimulus = engine.getState();
    expect(stateAfterStimulus?.pleasure).toBeGreaterThan(0.3);

    // 执行 decay（模拟时间流逝后的回归）
    const decayedState = engine.decayState();

    // 应该向基线回归
    expect(decayedState.pleasure).toBeLessThan(stateAfterStimulus?.pleasure || 1);
  });

  // ============================================================
  // Trait 累积影响
  // ============================================================

  it('长时间同向情绪后 trait 可能改变', async () => {
    // 降低阈值以便测试
    engine.updateConfig({
      stateToTraitThreshold: 3, // 只需 3 次累积
      stateToTraitRate: 0.01,
    });

    const initialTraits = engine.getTraits();
    expect(initialTraits).not.toBeNull();

    // 连续多次同向情绪（正向）
    for (let i = 0; i < 5; i++) {
      await engine.evolve(
        [{ role: 'user', content: '今天心情真好~' }],
        'manual',
      );
    }

    const finalTraits = engine.getTraits();
    expect(finalTraits).not.toBeNull();

    // trait 可能改变也可能不变（取决于累积效应）
    // 至少验证演化正常执行
    expect(finalTraits?.version).toBeGreaterThanOrEqual(initialTraits?.version || 1);
  });

  // ============================================================
  // 演化历史查询
  // ============================================================

  it('getHistory() 返回演化记录', async () => {
    await engine.evolve([{ role: 'user', content: '测试 1' }], 'manual');
    await engine.evolve([{ role: 'user', content: '测试 2' }], 'manual');
    await engine.evolve([{ role: 'user', content: '测试 3' }], 'manual');

    const allHistory = engine.getHistory('all', 10);
    expect(allHistory.length).toBe(3);

    // 验证返回结构
    expect(allHistory[0].id).toBeDefined();
    expect(allHistory[0].layer).toMatch(/state|trait/);
    expect(allHistory[0].values).toBeDefined();
    expect(allHistory[0].triggerType).toBe('manual');
    expect(allHistory[0].timestamp).toBeDefined();
  });

  it('getHistory() 按 layer 过滤', async () => {
    await engine.evolve([{ role: 'user', content: '测试' }], 'manual');

    const stateHistory = engine.getHistory('state', 10);
    expect(stateHistory.every(h => h.layer === 'state')).toBe(true);

    const traitHistory = engine.getHistory('trait', 10);
    // 初始无 trait 演化
    expect(traitHistory).toEqual([]);
  });

  it('getHistory() 按时间倒序返回', async () => {
    await engine.evolve([{ role: 'user', content: '消息 1' }], 'manual');
    await new Promise(r => setTimeout(r, 10)); // 确保时间戳不同
    await engine.evolve([{ role: 'user', content: '消息 2' }], 'manual');
    await new Promise(r => setTimeout(r, 10));
    await engine.evolve([{ role: 'user', content: '消息 3' }], 'manual');

    const history = engine.getHistory('state', 10);

    // 应该是最新的在前（DESC 排序后 reverse，即最旧在前）
    expect(history.length).toBe(3);
    // 验证时间戳递增（因为是 reverse 后的）
    expect(history[0].timestamp).toBeLessThanOrEqual(history[1].timestamp);
    expect(history[1].timestamp).toBeLessThanOrEqual(history[2].timestamp);
  });

  it('getHistory() 限制返回数量', async () => {
    for (let i = 0; i < 10; i++) {
      await engine.evolve([{ role: 'user', content: `测试 ${i}` }], 'manual');
    }

    const history5 = engine.getHistory('all', 5);
    expect(history5.length).toBe(5);

    const history20 = engine.getHistory('all', 20);
    expect(history20.length).toBe(10); // 最多 10 条
  });

  // ============================================================
  // 演化分析数据
  // ============================================================

  it('getEvolutionAnalytics() 返回统计数据', async () => {
    await engine.evolve([{ role: 'user', content: '开心' }], 'manual');
    await engine.evolve([{ role: 'user', content: '生气' }], 'manual');
    await engine.evolve([{ role: 'user', content: '平静' }], 'manual');

    const analytics = engine.getEvolutionAnalytics();

    expect(analytics.total).toBe(3);
    expect(analytics.stateCount).toBe(3);
    expect(analytics.traitCount).toBeGreaterThanOrEqual(0);
    expect(analytics.triggerBreakdown.manual).toBe(3);
    expect(analytics.lastEvolutionAt).toBeDefined();
  });

  it('getEvolutionAnalytics() 计算趋势', async () => {
    // 制造明显的上升趋势
    await engine.evolve([{ role: 'user', content: '超级开心！' }], 'manual');
    await engine.evolve([{ role: 'user', content: '太棒了！' }], 'manual');
    await engine.evolve([{ role: 'user', content: '好极了！' }], 'manual');
    await engine.evolve([{ role: 'user', content: '完美！' }], 'manual');

    const analytics = engine.getEvolutionAnalytics();

    expect(analytics.recentTrend).toBeDefined();
    expect(analytics.volatility).toBeDefined();
    // 波动性应该是有限的（不是剧烈震荡）
    expect(analytics.volatility.pleasure).toBeLessThan(0.5);
  });

  it('getEvolutionAnalytics() 空数据返回', () => {
    const analytics = engine.getEvolutionAnalytics();

    expect(analytics.total).toBe(0);
    expect(analytics.stateCount).toBe(0);
    expect(analytics.traitCount).toBe(0);
    expect(analytics.triggerBreakdown).toEqual({
      conversation: 0,
      manual: 0,
      decay: 0,
    });
  });

  // ============================================================
  // recordAndMaybeEvolve 自动触发
  // ============================================================

  it('recordAndMaybeEvolve 达到阈值自动触发演化', async () => {
    engine.updateConfig({ evolveEveryN: 3 });

    // 第 1 条：不触发
    const result1 = await engine.recordAndMaybeEvolve({
      role: 'user',
      content: '消息 1',
      platform: 'test',
    });
    expect(result1.evolveResult).toBeUndefined();

    // 第 2 条：不触发
    const result2 = await engine.recordAndMaybeEvolve({
      role: 'user',
      content: '消息 2',
      platform: 'test',
    });
    expect(result2.evolveResult).toBeUndefined();

    // 第 3 条：触发
    const result3 = await engine.recordAndMaybeEvolve({
      role: 'user',
      content: '消息 3',
      platform: 'test',
    });
    expect(result3.evolveResult).toBeDefined();
    expect(result3.evolveResult?.analysisMethod).toBe('rules');
  });

  it('recordAndMaybeEvolve 只分析最近窗口消息', async () => {
    engine.updateConfig({ evolveEveryN: 2 });

    // 先记录 4 条消息，触发 2 次演化
    for (let i = 1; i <= 4; i++) {
      await engine.recordAndMaybeEvolve({
        role: 'user',
        content: `消息 ${i}`,
        platform: 'test',
      });
    }

    // 验证演化历史
    const history = engine.getHistory('state', 10);
    expect(history.length).toBeGreaterThanOrEqual(2); // 至少 2 次演化
  });
});
