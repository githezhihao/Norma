import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PersonaEngine } from '@/core/persona-engine.js';

function createTestDbPath(): string {
  const id = Math.random().toString(36).slice(2, 9);
  return join(tmpdir(), `persona-recall-test-${id}.db`);
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

describe('PersonaEngine.recall - 记忆检索', () => {
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

  // ============================================================
  // LIKE 降级检索（FTS/向量不可用时）
  // ============================================================

  it('空查询返回空结果', async () => {
    const results = await engine.recall('');
    expect(results).toEqual([]);
  });

  it('纯空格查询返回空结果', async () => {
    const results = await engine.recall('   ');
    expect(results).toEqual([]);
  });

  it('LIKE 检索返回包含关键词的消息', async () => {
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
    await engine.recordMessage({
      role: 'user',
      content: '我喜欢在家里待着',
      platform: 'test',
    });

    const results = await engine.recall('天气');

    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.message.content.includes('天气'))).toBe(true);
  });

  it('LIKE 检索支持模糊匹配', async () => {
    await engine.recordMessage({
      role: 'user',
      content: '学习 TypeScript 中...',
      platform: 'test',
    });
    await engine.recordMessage({
      role: 'user',
      content: 'Python 也很有趣',
      platform: 'test',
    });

    const results = await engine.recall('Script');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].message.content).toContain('TypeScript');
  });

  // ============================================================
  // FTS5 全文检索
  // ============================================================

  it('FTS5 多词匹配', async () => {
    await engine.recordMessage({
      role: 'user',
      content: '数据仓库的 ETL 流程很重要',
      platform: 'test',
    });
    await engine.recordMessage({
      role: 'user',
      content: '前端 Vue 组件开发技巧',
      platform: 'test',
    });
    await engine.recordMessage({
      role: 'user',
      content: 'ETL 和数据 pipeline 是数据工程的核心',
      platform: 'test',
    });

    // 查询包含"ETL"的内容
    const results = await engine.recall('ETL');

    expect(results.length).toBeGreaterThanOrEqual(1);
    const contents = results.map(r => r.message.content);
    expect(contents.some(c => c.includes('ETL'))).toBe(true);
  });

  it('FTS5 检索结果按相关性排序', async () => {
    await engine.recordMessage({
      role: 'user',
      content: 'TypeScript 类型系统详解',
      platform: 'test',
      timestamp: Date.now() - 3000,
    });
    await engine.recordMessage({
      role: 'user',
      content: '只是提到一下 type',
      platform: 'test',
      timestamp: Date.now() - 2000,
    });
    await engine.recordMessage({
      role: 'user',
      content: 'TypeScript 高级类型技巧，类型推断和类型守卫',
      platform: 'test',
      timestamp: Date.now() - 1000,
    });

    const results = await engine.recall('TypeScript 类型', 10);

    expect(results.length).toBeGreaterThanOrEqual(1);
    // 最相关的应该排在前面（关键词密度高 + 时间近）
    expect(results[0].message.content.includes('TypeScript')).toBe(true);
  });

  // ============================================================
  // 混合检索评分叠加
  // ============================================================

  it('FTS + 时间衰减组合评分', async () => {
    const now = Date.now();
    await engine.recordMessage({
      role: 'user',
      content: '测试内容 A',
      platform: 'test',
      timestamp: now - 86400000 * 10, // 10 天前
    });
    await engine.recordMessage({
      role: 'user',
      content: '测试内容 B',
      platform: 'test',
      timestamp: now - 86400000, // 1 天前
    });
    await engine.recordMessage({
      role: 'user',
      content: '测试内容 C',
      platform: 'test',
      timestamp: now - 3600000, // 1 小时前
    });

    const results = await engine.recall('测试', 10);

    expect(results.length).toBe(3);
    // 时间越近 relevance 越高（在其他条件相同的情况下）
    // C 应该比 A 的相关性高
    const resultC = results.find(r => r.message.content === '测试内容 C');
    const resultA = results.find(r => r.message.content === '测试内容 A');
    expect(resultC).toBeDefined();
    expect(resultA).toBeDefined();
    if (resultC && resultA) {
      expect(resultC.relevance).toBeGreaterThan(resultA.relevance);
    }
  });

  // ============================================================
  // 向量检索（如果启用了 vec）
  // ============================================================

  it('向量检索返回语义相似的消息', async () => {
    // 只有在 vecEnabled 时才测试
    if (!engine.isVecEnabled()) {
      console.log('[SKIP] vec not enabled, skipping vector test');
      return;
    }

    await engine.recordMessage({
      role: 'user',
      content: '人工智能和机器学习是未来',
      platform: 'test',
    });
    await engine.recordMessage({
      role: 'user',
      content: '今天中午吃了汉堡',
      platform: 'test',
    });
    await engine.recordMessage({
      role: 'user',
      content: '深度学习神经网络算法',
      platform: 'test',
    });

    // 查询"AI 技术"，语义上应该匹配第一条和第三条
    const results = await engine.recall('AI 技术', 10);

    expect(results.length).toBeGreaterThan(0);
    // 语义相似的应该排前面
    const contents = results.map(r => r.message.content);
    // 至少有一条包含 AI/学习/网络 相关词
    expect(
      contents.some(c =>
        c.includes('人工智能') || c.includes('学习') || c.includes('网络'),
      ),
    ).toBe(true);
  });

  // ============================================================
  // 检索结果结构验证
  // ============================================================

  it('RecallResult 包含完整的消息结构', async () => {
    await engine.recordMessage({
      role: 'user',
      content: '测试消息结构',
      platform: 'claude-code',
      sessionId: 'test-session-123',
      metadata: { model: 'claude-sonnet-4-6', tokens: 100 },
    });

    const results = await engine.recall('测试');

    expect(results.length).toBe(1);
    const result = results[0];

    // 验证 RecallResult 结构
    expect(result.relevance).toBeGreaterThan(0);
    expect(result.source).toMatch(/fts|vec|like/);

    // 验证 message 结构
    expect(result.message.id).toBeDefined();
    expect(result.message.content).toBe('测试消息结构');
    expect(result.message.platform).toBe('claude-code');
    expect(result.message.sessionId).toBe('test-session-123');
    expect(result.message.role).toBe('user');
    expect(result.message.metadata).toEqual({
      model: 'claude-sonnet-4-6',
      tokens: 100,
    });
  });

  // ============================================================
  // 边界情况
  // ============================================================

  it('查询结果数量限制', async () => {
    for (let i = 0; i < 20; i++) {
      await engine.recordMessage({
        role: 'user',
        content: `测试消息 ${i}`,
        platform: 'test',
      });
    }

    const results5 = await engine.recall('测试', 5);
    expect(results5.length).toBe(5);

    const results10 = await engine.recall('测试', 10);
    expect(results10.length).toBe(10);
  });

  it('特殊字符查询不崩溃', async () => {
    await engine.recordMessage({
      role: 'user',
      content: '测试特殊字符：!@#$%^&*()',
      platform: 'test',
    });

    // 特殊字符查询不应该崩溃
    await expect(engine.recall('!@#')).resolves.not.toThrow();
  });
});
