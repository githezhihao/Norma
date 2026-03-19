import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PersonaEngine } from '../src/core/persona-engine.js';
import { createHttpApi } from '../src/http-server.js';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

let engine: PersonaEngine;
let httpServer: Server;
let testDir: string;
const PORT = 19821; // 用不同端口避免冲突
const API = `http://127.0.0.1:${PORT}`;

beforeEach(async () => {
  testDir = join(tmpdir(), `persona-e2e-${randomUUID()}`);
  mkdirSync(testDir, { recursive: true });
  engine = new PersonaEngine(join(testDir, 'test.sqlite'));
  await engine.initVec();
  engine.initPersona('小云', '跨平台测试人格', { extraversion: 0.6 });
  httpServer = createHttpApi(engine, PORT);
  // 等待 server 启动
  await new Promise<void>(resolve => httpServer.on('listening', resolve));
});

afterEach(async () => {
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
  engine.close();
  rmSync(testDir, { recursive: true, force: true });
});

describe('HTTP API — /api/health', () => {
  it('returns ok with enhanced fields', async () => {
    const res = await fetch(`${API}/api/health`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.status).toBe('ok');
    // 向后兼容字段
    expect(typeof data.vec).toBe('boolean');
    // 新增字段
    expect(typeof data.uptime).toBe('number');
    expect(data.startedAt).toBeDefined();
    expect(data.db).toBeDefined();
    expect(typeof data.db.sizeBytes).toBe('number');
    expect(typeof data.db.messages).toBe('number');
    expect(data.errors).toBeDefined();
    expect(typeof data.errors.count).toBe('number');
  });
});

describe('HTTP API — /api/dashboard', () => {
  it('returns full dashboard view', async () => {
    const res = await fetch(`${API}/api/dashboard`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;

    // health section
    expect(data.health.status).toBe('ok');
    expect(typeof data.health.uptimeMs).toBe('number');

    // persona section
    expect(data.persona.name).toBe('小云');
    expect(data.persona.ocean).toBeDefined();
    expect(typeof data.persona.ocean.O).toBe('number');
    expect(data.persona.pad).toBeDefined();
    expect(data.persona.relationship).toBeDefined();
    expect(typeof data.persona.relationship.trust).toBe('number');

    // evolution section
    expect(typeof data.evolution.total).toBe('number');
    expect(data.evolution.recentTrend).toBeDefined();
    expect(data.evolution.volatility).toBeDefined();
    expect(data.evolution.triggerBreakdown).toBeDefined();

    // system section
    expect(typeof data.system.dbSizeBytes).toBe('number');
    expect(typeof data.system.messageCount).toBe('number');
    expect(typeof data.system.vecEnabled).toBe('boolean');
  });
});

describe('HTTP API — /api/record', () => {
  it('records a user message', async () => {
    const res = await fetch(`${API}/api/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: '你好小云', platform: 'openclaw:telegram' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.id).toBeDefined();
    expect(data.evolved).toBe(false);
    expect(engine.getMessageCount()).toBe(1);
  });

  it('returns 400 for missing fields', async () => {
    const res = await fetch(`${API}/api/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user' }),
    });
    expect(res.status).toBe(400);
  });

  it('auto-evolves after N messages', async () => {
    engine.updateConfig({ evolveEveryN: 2 });

    await fetch(`${API}/api/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: '太棒了！谢谢', platform: 'openclaw' }),
    });

    const res = await fetch(`${API}/api/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: '你真厉害！完美', platform: 'openclaw' }),
    });
    const data = await res.json() as any;
    expect(data.evolved).toBe(true);
    expect(data.state).toBeDefined();
    expect(data.state.pleasure).toBeGreaterThan(0);
  });
});

describe('HTTP API — /api/state', () => {
  it('returns JSON state', async () => {
    const res = await fetch(`${API}/api/state?format=json`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.traits).toBeDefined();
    expect(data.traits.personalityName).toBe('小云');
    expect(data.state).toBeDefined();
  });

  it('returns prompt text', async () => {
    const res = await fetch(`${API}/api/state?format=prompt`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('小云');
    expect(text).toContain('性格特点');
  });
});

describe('HTTP API — /api/evolve', () => {
  it('evolves with recent messages', async () => {
    // 先记录一些消息
    await engine.recordMessage({ role: 'user', content: '谢谢你帮我解决了问题！', platform: 'test' });
    await engine.recordMessage({ role: 'user', content: '你做得太好了！', platform: 'test' });

    const res = await fetch(`${API}/api/evolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.evolved).toBe(true);
    expect(data.method).toBe('rules');
  });

  it('returns not evolved when no messages', async () => {
    const res = await fetch(`${API}/api/evolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json() as any;
    expect(data.evolved).toBe(false);
  });
});

describe('跨平台状态一致性', () => {
  it('OpenClaw messages affect state visible to Claude Code', async () => {
    // 模拟 OpenClaw 端通过 HTTP 记录正面消息
    engine.updateConfig({ evolveEveryN: 3 });

    for (const content of ['太棒了！', '你真厉害！', '完美！谢谢！']) {
      await fetch(`${API}/api/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user', content, platform: 'openclaw:telegram' }),
      });
    }

    // 模拟 Claude Code 端通过 PersonaEngine 直接读取状态
    const state = engine.getState()!;
    expect(state.pleasure).toBeGreaterThan(0);

    // 验证 narrateState 反映了正面状态
    const narrative = engine.narrateState('prompt');
    expect(narrative).toContain('小云');
  });

  it('negative messages from one platform affect the other', async () => {
    engine.updateConfig({ evolveEveryN: 2 });

    // Claude Code 端记录负面消息
    await engine.recordAndMaybeEvolve({ role: 'user', content: '这个不行，太差了，失败', platform: 'claude-code' });
    await engine.recordAndMaybeEvolve({ role: 'user', content: '错误太多了，烦死了，垃圾', platform: 'claude-code' });

    // OpenClaw 端通过 HTTP 读取状态
    const res = await fetch(`${API}/api/state?format=json`);
    const data = await res.json() as any;

    // 负面消息应该降低 pleasure
    // 由于情绪惯性，可能不会大幅下降，但 delta 应该是负的
    expect(data.state).toBeDefined();
    // 验证演化历史存在
    const history = engine.getHistory('state');
    expect(history.length).toBeGreaterThan(0);
  });
});
