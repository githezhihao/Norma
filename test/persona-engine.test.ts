import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PersonaEngine } from '../src/core/persona-engine.js';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

let engine: PersonaEngine;
let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `persona-test-${randomUUID()}`);
  mkdirSync(testDir, { recursive: true });
  engine = new PersonaEngine(join(testDir, 'test.sqlite'));
});

afterEach(() => {
  engine.close();
  rmSync(testDir, { recursive: true, force: true });
});

describe('PersonaEngine — 人格管理', () => {
  it('initPersona sets OCEAN traits and state', () => {
    const traits = engine.initPersona('小云', '可爱的 AI 助手', {
      openness: 0.8,
      extraversion: 0.6,
    });

    expect(traits.personalityName).toBe('小云');
    expect(traits.openness).toBe(0.8);
    expect(traits.extraversion).toBe(0.6);
    expect(traits.version).toBe(1);

    const state = engine.getState();
    expect(state).not.toBeNull();
    expect(state!.pleasure).toBe(0.2);
  });

  it('getTraits returns null before init', () => {
    expect(engine.getTraits()).toBeNull();
  });

  it('getRelationship returns defaults', () => {
    const rel = engine.getRelationship();
    expect(rel.totalInteractions).toBe(0);
    expect(rel.trustLevel).toBe(0.5);
  });
});

describe('PersonaEngine — 对话记录与检索', () => {
  it('records and counts messages', async () => {
    await engine.recordMessage({ role: 'user', content: '你好', platform: 'test' });
    await engine.recordMessage({ role: 'assistant', content: '你好！', platform: 'test' });
    expect(engine.getMessageCount()).toBe(2);
  });

  it('recalls messages via FTS', async () => {
    await engine.recordMessage({ role: 'user', content: '帮我写一个排序算法', platform: 'test' });
    await engine.recordMessage({ role: 'user', content: '今天天气真好', platform: 'test' });

    const results = await engine.recall('排序');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].message.content).toContain('排序');
  });

  it('getRecentMessages returns in chronological order', async () => {
    await engine.recordMessage({ role: 'user', content: 'first', platform: 'test', timestamp: 1000 });
    await engine.recordMessage({ role: 'user', content: 'second', platform: 'test', timestamp: 2000 });

    const msgs = engine.getRecentMessages(10);
    expect(msgs[0].content).toBe('first');
    expect(msgs[1].content).toBe('second');
  });
});

describe('PersonaEngine — 演化', () => {
  it('evolves state with positive messages', async () => {
    engine.initPersona('小云');
    const stateBefore = engine.getState()!;

    const result = await engine.evolve([
      { role: 'user', content: '太棒了！谢谢你，做得非常好！' },
      { role: 'user', content: '完美，我很满意，你真厉害！' },
    ]);

    expect(result.analysisMethod).toBe('rules');
    expect(result.analysis.userTone).toBeGreaterThan(0);
    expect(result.newState.pleasure).toBeGreaterThanOrEqual(stateBefore.pleasure);
  });

  it('evolves state with negative messages', async () => {
    engine.initPersona('小云');

    const result = await engine.evolve([
      { role: 'user', content: '这个不行，太差了' },
      { role: 'user', content: '失败了，我很失望，太糟糕了' },
    ]);

    expect(result.analysis.userTone).toBeLessThan(0);
    expect(result.analysis.suggestedStateDelta.pleasure).toBeLessThan(0);
  });

  it('records evolution history', async () => {
    engine.initPersona('小云');
    await engine.evolve([{ role: 'user', content: '你好' }]);

    const history = engine.getHistory('state');
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].layer).toBe('state');
  });

  it('updates relationship on evolve', async () => {
    engine.initPersona('小云');
    const relBefore = engine.getRelationship();
    await engine.evolve([{ role: 'user', content: '谢谢你，做得很好！' }]);
    const relAfter = engine.getRelationship();
    expect(relAfter.totalInteractions).toBe(relBefore.totalInteractions + 1);
  });

  it('decayState reverts toward baseline', () => {
    engine.initPersona('小云');
    const state = engine.getState()!;
    const decayed = engine.decayState();
    // decayState 应该记录历史
    const history = engine.getHistory('state');
    expect(history.length).toBeGreaterThan(0);
    expect(typeof decayed.pleasure).toBe('number');
  });
});

describe('PersonaEngine — recordAndMaybeEvolve', () => {
  it('auto-evolves after N messages', async () => {
    engine.initPersona('小云');
    engine.updateConfig({ evolveEveryN: 2 });

    const r1 = await engine.recordAndMaybeEvolve({ role: 'user', content: '你好', platform: 'test' });
    expect(r1.evolveResult).toBeUndefined();

    const r2 = await engine.recordAndMaybeEvolve({ role: 'user', content: '谢谢', platform: 'test' });
    expect(r2.evolveResult).toBeDefined();
    expect(r2.evolveResult!.analysisMethod).toBe('rules');
  });
});

describe('PersonaEngine — 状态输出', () => {
  it('narrateState returns prompt text', () => {
    engine.initPersona('小云', '可爱的 AI 助手');
    const text = engine.narrateState('prompt');
    expect(text).toContain('小云');
    expect(text).toContain('性格特点');
  });

  it('narrateState returns JSON', () => {
    engine.initPersona('小云');
    const json = engine.narrateState('json');
    const parsed = JSON.parse(json);
    expect(parsed.traits).toBeDefined();
    expect(parsed.state).toBeDefined();
    expect(parsed.relationship).toBeDefined();
  });

  it('narrateBrief returns one-line summary', () => {
    engine.initPersona('小云');
    const brief = engine.narrateBrief();
    expect(brief.length).toBeGreaterThan(0);
    expect(brief.length).toBeLessThan(100);
  });
});

describe('PersonaEngine — 配置', () => {
  it('getConfig returns defaults', () => {
    const cfg = engine.getConfig();
    expect(cfg.evolveEveryN).toBe(5);
    expect(cfg.emotionalInertia).toBe(0.6);
  });

  it('updateConfig merges partial', () => {
    engine.updateConfig({ evolveEveryN: 10 });
    expect(engine.getConfig().evolveEveryN).toBe(10);
    expect(engine.getConfig().emotionalInertia).toBe(0.6);
  });

  it('LLM config defaults to null', () => {
    expect(engine.getLlmConfig()).toBeNull();
  });

  it('setLlmConfig stores config', () => {
    engine.setLlmConfig({ provider: 'ollama', model: 'llama3' });
    expect(engine.getLlmConfig()!.provider).toBe('ollama');
  });
});

describe('PersonaEngine — getMetrics', () => {
  it('returns runtime metrics', () => {
    engine.initPersona('小云');
    const metrics = engine.getMetrics();
    expect(metrics.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(metrics.startedAt).toBeGreaterThan(0);
    expect(metrics.messageCount).toBe(0);
    expect(metrics.evolveCount).toBe(0);
    expect(metrics.errorCount).toBe(0);
    expect(metrics.lastEvolveAt).toBeNull();
    expect(metrics.lastError).toBeNull();
    expect(metrics.dbSizeBytes).toBeGreaterThan(0);
    expect(metrics.vecEnabled).toBe(false);
    expect(metrics.llmProvider).toBeNull();
  });

  it('tracks evolve count after evolution', async () => {
    engine.initPersona('小云');
    await engine.evolve([{ role: 'user', content: '你好' }]);
    const metrics = engine.getMetrics();
    expect(metrics.evolveCount).toBe(1);
    expect(metrics.lastEvolveAt).not.toBeNull();
  });

  it('tracks message count', async () => {
    await engine.recordMessage({ role: 'user', content: '测试', platform: 'test' });
    const metrics = engine.getMetrics();
    expect(metrics.messageCount).toBe(1);
  });
});

describe('PersonaEngine — getEvolutionAnalytics', () => {
  it('returns empty analytics when no history', () => {
    const analytics = engine.getEvolutionAnalytics();
    expect(analytics.total).toBe(0);
    expect(analytics.stateCount).toBe(0);
    expect(analytics.traitCount).toBe(0);
    expect(analytics.triggerBreakdown.conversation).toBe(0);
    expect(analytics.lastEvolutionAt).toBeNull();
    expect(analytics.recentTrend.pleasure).toBe('stable');
    expect(analytics.volatility.pleasure).toBe(0);
  });

  it('returns analytics after evolutions', async () => {
    engine.initPersona('小云');
    await engine.evolve([{ role: 'user', content: '太棒了！谢谢' }]);
    await engine.evolve([{ role: 'user', content: '你真厉害' }], 'manual');
    engine.decayState();

    const analytics = engine.getEvolutionAnalytics();
    expect(analytics.total).toBe(3);
    expect(analytics.stateCount).toBe(3);
    expect(analytics.triggerBreakdown.conversation).toBe(1);
    expect(analytics.triggerBreakdown.manual).toBe(1);
    expect(analytics.triggerBreakdown.decay).toBe(1);
    expect(analytics.lastEvolutionAt).not.toBeNull();
  });
});
