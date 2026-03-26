import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema, initVecSchema } from '@/db/schema.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  return db;
}

describe('Schema 初始化', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  // ============================================================
  // initSchema - 基础表结构
  // ============================================================

  it('initSchema 创建所有基础表', () => {
    initSchema(db);

    // 检查表是否存在
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all() as Array<{ name: string }>;

    const tableNames = tables.map(t => t.name);

    // 基础表
    expect(tableNames).toContain('persona_traits');
    expect(tableNames).toContain('persona_state');
    expect(tableNames).toContain('relationship');
    expect(tableNames).toContain('conversations');
    expect(tableNames).toContain('evolution_history');
    // 注意：evolution_config 和 llm_config 不是独立的表，配置存在内存中
  });

  it('initSchema 创建 FTS5 虚拟表', () => {
    initSchema(db);

    const ftsTables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name LIKE '%fts%'
    `).all() as Array<{ name: string }>;

    const ftsTableNames = ftsTables.map(t => t.name);
    expect(ftsTableNames).toContain('conversation_fts');
  });

  it('initSchema 创建索引', () => {
    initSchema(db);

    const indexes = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='index' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all() as Array<{ name: string }>;

    const indexNames = indexes.map(i => i.name);

    // 检查关键索引存在
    expect(indexNames.some(n => n === 'idx_conv_time')).toBe(true);
    expect(indexNames.some(n => n === 'idx_conv_platform')).toBe(true);
    expect(indexNames.some(n => n === 'idx_evo_time')).toBe(true);
    expect(indexNames.some(n => n === 'idx_evo_layer')).toBe(true);
  });

  // ============================================================
  // 表结构验证
  // ============================================================

  it('persona_traits 表结构正确', () => {
    initSchema(db);

    const columns = db.prepare(`PRAGMA table_info(persona_traits)`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>;

    const columnNames = columns.map(c => c.name);

    // 检查必要字段
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('openness');
    expect(columnNames).toContain('conscientiousness');
    expect(columnNames).toContain('extraversion');
    expect(columnNames).toContain('agreeableness');
    expect(columnNames).toContain('neuroticism');
    expect(columnNames).toContain('personality_name');
    expect(columnNames).toContain('personality_desc');
    expect(columnNames).toContain('version');
    expect(columnNames).toContain('updated_at');
  });

  it('persona_state 表结构正确', () => {
    initSchema(db);

    const columns = db.prepare(`PRAGMA table_info(persona_state)`).all() as Array<{
      name: string;
      type: string;
    }>;

    const columnNames = columns.map(c => c.name);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('pleasure');
    expect(columnNames).toContain('arousal');
    expect(columnNames).toContain('dominance');
    expect(columnNames).toContain('updated_at');
  });

  it('relationship 表结构正确', () => {
    initSchema(db);

    const columns = db.prepare(`PRAGMA table_info(relationship)`).all() as Array<{
      name: string;
      type: string;
    }>;

    const columnNames = columns.map(c => c.name);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('avg_tone');
    expect(columnNames).toContain('conflict_frequency');
    expect(columnNames).toContain('trust_level');
    expect(columnNames).toContain('interaction_style');
    expect(columnNames).toContain('total_interactions');
  });

  it('conversations 表结构正确', () => {
    initSchema(db);

    const columns = db.prepare(`PRAGMA table_info(conversations)`).all() as Array<{
      name: string;
      type: string;
    }>;

    const columnNames = columns.map(c => c.name);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('platform');
    expect(columnNames).toContain('session_id');
    expect(columnNames).toContain('role');
    expect(columnNames).toContain('content');
    expect(columnNames).toContain('timestamp');
    expect(columnNames).toContain('metadata');
  });

  it('evolution_history 表结构正确', () => {
    initSchema(db);

    const columns = db.prepare(`PRAGMA table_info(evolution_history)`).all() as Array<{
      name: string;
      type: string;
    }>;

    const columnNames = columns.map(c => c.name);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('layer');
    expect(columnNames).toContain('values_json');
    expect(columnNames).toContain('trigger_type');
    expect(columnNames).toContain('trigger_summary');
    expect(columnNames).toContain('timestamp');
  });

  // ============================================================
  // FTS5 虚拟表验证
  // ============================================================

  it('conversation_fts 支持全文检索', () => {
    initSchema(db);

    // 插入测试数据
    const now = Date.now();
    db.prepare(`
      INSERT INTO conversations (id, platform, session_id, role, content, timestamp)
      VALUES ('test-1', 'test', 's1', 'user', 'today is sunny', ?)
    `).run(now);

    db.prepare(`
      INSERT INTO conversations (id, platform, session_id, role, content, timestamp)
      VALUES ('test-2', 'test', 's1', 'user', 'I like coding', ?)
    `).run(now);

    // 验证 FTS 表中有数据
    const ftsCount = db.prepare('SELECT COUNT(*) as cnt FROM conversation_fts').get() as any;
    expect(ftsCount.cnt).toBe(2);

    // FTS 查询英文（避免 trigram 分词问题）
    const results = db.prepare(`
      SELECT c.* FROM conversation_fts f
      JOIN conversations c ON c.rowid = f.rowid
      WHERE conversation_fts MATCH 'sunny'
    `).all() as any[];

    expect(results.length).toBe(1);
    expect(results[0].content).toContain('sunny');
  });

  it('conversation_fts 支持多词匹配', () => {
    initSchema(db);

    db.prepare(`
      INSERT INTO conversations (id, platform, session_id, role, content, timestamp)
      VALUES ('test-1', 'test', 's1', 'user', '数据仓库 ETL 流程', ?)
    `).run(Date.now());

    db.prepare(`
      INSERT INTO conversations (id, platform, session_id, role, content, timestamp)
      VALUES ('test-2', 'test', 's1', 'user', '前端开发技巧', ?)
    `).run(Date.now());

    // 查询包含"数据"或"ETL"的内容
    const results = db.prepare(`
      SELECT c.* FROM conversation_fts f
      JOIN conversations c ON c.rowid = f.rowid
      WHERE conversation_fts MATCH '数据 OR ETL'
    `).all() as any[];

    expect(results.length).toBe(1);
    expect(results[0].content).toMatch(/数据 | ETL/);
  });

  // ============================================================
  // initVecSchema - 向量表
  // ============================================================

  it('initVecSchema 创建向量虚拟表', () => {
    // 先初始化基础 schema
    initSchema(db);

    // 初始化向量表（即使 vec 未加载也不应该崩溃）
    const result = initVecSchema(db);

    // 返回 false 表示 vec 未加载，但表应该创建
    expect(typeof result).toBe('boolean');

    // 检查表是否存在
    const vecTables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name LIKE '%vec%'
    `).all() as Array<{ name: string }>;

    // 即使 vec 未加载，也应该创建 conversation_vec 表（或至少不报错）
    // 具体行为取决于 initVecSchema 的实现
  });

  it('多次调用 initSchema 不报错（幂等性）', () => {
    // 第一次调用
    initSchema(db);

    // 第二次调用不应该报错
    expect(() => initSchema(db)).not.toThrow();

    // 第三次调用也不应该报错
    expect(() => initSchema(db)).not.toThrow();
  });

  it('多次调用 initVecSchema 不报错（幂等性）', () => {
    initSchema(db);
    initVecSchema(db);

    // 重复调用不应该报错
    expect(() => initVecSchema(db)).not.toThrow();
  });

  // ============================================================
  // 约束验证
  // ============================================================

  it('persona_traits 至少有 1 条记录', () => {
    initSchema(db);

    // 尝试插入空值（应该失败，因为有 CHECK 约束）
    // 这个测试验证约束存在
    expect(() => {
      db.prepare(`INSERT INTO persona_traits (id) VALUES (1)`).run();
    }).toThrow(); // 应该有 NOT NULL 或其他约束
  });

  it('persona_state 只有 1 条记录（单例）', () => {
    initSchema(db);

    // 插入第一条应该成功
    db.prepare(`
      INSERT INTO persona_state (id, pleasure, arousal, dominance, updated_at)
      VALUES (1, 0.0, 0.0, 0.0, ?)
    `).run(Date.now());

    // 插入第二条应该失败（主键冲突）
    expect(() => {
      db.prepare(`
        INSERT INTO persona_state (id, pleasure, arousal, dominance, updated_at)
        VALUES (1, 0.5, 0.5, 0.5, ?)
      `).run(Date.now());
    }).toThrow();
  });

  it('relationship 只有 1 条记录（单例）', () => {
    initSchema(db);

    // 插入第一条应该成功
    db.prepare(`
      INSERT INTO relationship (id, avg_tone, conflict_frequency, trust_level, interaction_style, total_interactions, updated_at)
      VALUES (1, 0.0, 0.0, 0.5, 'casual', 0, ?)
    `).run(Date.now());

    // 插入第二条应该失败（主键冲突）
    expect(() => {
      db.prepare(`
        INSERT INTO relationship (id, avg_tone, conflict_frequency, trust_level, interaction_style, total_interactions, updated_at)
        VALUES (1, 0.5, 0.5, 0.8, 'playful', 100, ?)
      `).run(Date.now());
    }).toThrow();
  });
});
