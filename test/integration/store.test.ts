import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  recordMessage,
  getRecentMessages,
  getRecentUserMessages,
  getMessageCount,
} from '@/memory/store.js';
import { initSchema } from '@/db/schema.js';
import { setEmbeddingConfig } from '@/memory/store.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  initSchema(db);
  return db;
}

describe('recordMessage', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    // 禁用 embedding（测试环境不依赖外部 API）
    setEmbeddingConfig({ provider: 'none' });
  });

  it('成功记录消息', async () => {
    const msg = {
      role: 'user' as const,
      content: '你好，小云！',
      platform: 'claude-code',
      sessionId: 'test-session-1',
      timestamp: Date.now(),
      metadata: null,
    };

    const result = await recordMessage(db, msg);

    expect(result.id).toBeDefined();
    expect(result.content).toBe('你好，小云！');
    expect(result.platform).toBe('claude-code');
    expect(result.role).toBe('user');
  });

  it('记录消息带 metadata', async () => {
    const msg = {
      role: 'assistant' as const,
      content: '老大好~',
      platform: 'claude-code',
      sessionId: 'test-session-1',
      timestamp: Date.now(),
      metadata: { model: 'claude-sonnet-4-6', tokens: 100 },
    };

    const result = await recordMessage(db, msg);

    expect(result.metadata).toEqual({ model: 'claude-sonnet-4-6', tokens: 100 });
  });

  it('sessionId 可为 null', async () => {
    const msg = {
      role: 'user' as const,
      content: '全局消息',
      platform: 'web',
      sessionId: null,
      timestamp: Date.now(),
      metadata: null,
    };

    const result = await recordMessage(db, msg);

    expect(result.sessionId).toBeNull();
  });
});

describe('getRecentMessages', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = createTestDb();
    setEmbeddingConfig({ provider: 'none' });

    // 插入测试数据
    const now = Date.now();
    await recordMessage(db, {
      role: 'user',
      content: '消息 1',
      platform: 'claude-code',
      sessionId: 'session-1',
      timestamp: now - 3000,
      metadata: null,
    });
    await recordMessage(db, {
      role: 'assistant',
      content: '回复 1',
      platform: 'claude-code',
      sessionId: 'session-1',
      timestamp: now - 2000,
      metadata: null,
    });
    await recordMessage(db, {
      role: 'user',
      content: '消息 2',
      platform: 'web',
      sessionId: 'session-2',
      timestamp: now - 1000,
      metadata: null,
    });
    await recordMessage(db, {
      role: 'user',
      content: '消息 3',
      platform: 'claude-code',
      sessionId: 'session-1',
      timestamp: now,
      metadata: null,
    });
  });

  it('按时间倒序返回消息', async () => {
    const messages = getRecentMessages(db, 10);

    expect(messages.length).toBe(4);
    expect(messages[0].content).toBe('消息 1'); // 最旧
    expect(messages[3].content).toBe('消息 3'); // 最新
  });

  it('限制返回数量', async () => {
    const messages = getRecentMessages(db, 2);

    expect(messages.length).toBe(2);
    expect(messages[0].content).toBe('消息 2');
    expect(messages[1].content).toBe('消息 3');
  });

  it('按平台过滤', async () => {
    const messages = getRecentMessages(db, 10, 'web');

    expect(messages.length).toBe(1);
    expect(messages[0].platform).toBe('web');
    expect(messages[0].content).toBe('消息 2');
  });

  it('claude-code 平台过滤', async () => {
    const messages = getRecentMessages(db, 10, 'claude-code');

    expect(messages.length).toBe(3);
    expect(messages.every(m => m.platform === 'claude-code')).toBe(true);
  });
});

describe('getRecentUserMessages', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = createTestDb();
    setEmbeddingConfig({ provider: 'none' });

    const now = Date.now();
    await recordMessage(db, {
      role: 'user',
      content: '用户消息 1',
      platform: 'claude-code',
      sessionId: 'session-1',
      timestamp: now - 4000,
      metadata: null,
    });
    await recordMessage(db, {
      role: 'assistant',
      content: '助手回复',
      platform: 'claude-code',
      sessionId: 'session-1',
      timestamp: now - 3000,
      metadata: null,
    });
    await recordMessage(db, {
      role: 'user',
      content: '用户消息 2',
      platform: 'claude-code',
      sessionId: 'session-1',
      timestamp: now - 2000,
      metadata: null,
    });
  });

  it('返回包含 role 和 content 的简单数组', () => {
    const messages = getRecentUserMessages(db, 10);

    // 函数返回最近 limit 条消息（包括 assistant），然后 reverse
    expect(messages.length).toBe(3);  // 3 条消息
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('用户消息 1');
    expect(messages[1].content).toBe('助手回复');
    expect(messages[2].content).toBe('用户消息 2');
  });

  it('限制返回数量', () => {
    const messages = getRecentUserMessages(db, 1);

    // 注意：函数内部会 reverse，所以返回最新的 1 条
    expect(messages.length).toBe(1);
    expect(messages[0].content).toBe('用户消息 2');
  });
});

describe('getMessageCount', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    setEmbeddingConfig({ provider: 'none' });
  });

  it('空数据库返回 0', () => {
    expect(getMessageCount(db)).toBe(0);
  });

  it('返回总消息数', async () => {
    await recordMessage(db, {
      role: 'user',
      content: '消息 1',
      platform: 'claude-code',
      sessionId: 'session-1',
      timestamp: Date.now(),
      metadata: null,
    });
    await recordMessage(db, {
      role: 'assistant',
      content: '回复',
      platform: 'claude-code',
      sessionId: 'session-1',
      timestamp: Date.now(),
      metadata: null,
    });

    expect(getMessageCount(db)).toBe(2);
  });
});
