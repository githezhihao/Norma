// ============================================================
// PersonaEngine — Layer 1 核心引擎
// 纯业务逻辑封装，零协议依赖
// 将散落在各模块的函数 + 模块级状态统一收口到类实例
// ============================================================

import Database from 'better-sqlite3';
import { mkdirSync, appendFileSync, statSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';

// ---- 日志 ----
const LOG_PATH = resolve(process.env.PERSONA_LOG ?? `${process.env.HOME ?? '.'}/.norma/persona.log`);
const LOG_JSON = process.env.PERSONA_LOG_FORMAT === 'json';
// 强制启用DEBUG日志进行诊断
const LOG_DEBUG = true; // process.env.PERSONA_DEBUG === '1';
const LOG_MAX_BYTES = 5 * 1024 * 1024; // 5MB

export function log(level: 'INFO' | 'WARN' | 'ERR' | 'DEBUG', tag: string, msg: string): void {
  if (level === 'DEBUG' && !LOG_DEBUG) return;
  // 简单轮转
  try {
    const st = statSync(LOG_PATH);
    if (st.size > LOG_MAX_BYTES) {
      renameSync(LOG_PATH, LOG_PATH + '.1');
    }
  } catch { /* file may not exist yet */ }

  // 时间戳：本地时间 + 时区偏移
  const now = new Date();
  const offset = now.getTimezoneOffset() * -1;
  const hours = Math.floor(Math.abs(offset) / 60);
  const minutes = Math.abs(offset) % 60;
  const sign = offset >= 0 ? '+' : '-';
  const tz = `${sign}${hours.toString().padStart(2, '0')}${minutes.toString().padStart(2, '0')}`;

  const pad = (n: number) => n.toString().padStart(2, '0');
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())} ${tz}`;

  let line: string;
  if (LOG_JSON) {
    line = JSON.stringify({ ts, level, tag, msg }) + '\n';
  } else {
    line = `${ts} [${level}] [${tag}] ${msg}\n`;
  }
  try { appendFileSync(LOG_PATH, line); } catch { /* ignore */ }
  if (level === 'ERR') process.stderr.write(line);
}
import { initSchema, initVecSchema } from '../db/schema.js';
import { initTraitsIfNeeded, getTraits, upsertTraits, updateTraitValues } from '../persona/traits.js';
import { initStateIfNeeded, getState, upsertState } from '../persona/states.js';
import { getRelationship, updateRelationship } from '../persona/relationship.js';
import { analyzeByRules } from '../persona/analyzer.js';
import { analyzeByLlm } from '../persona/llm-analyzer.js';
import { narrateFullState, narrateBrief } from '../persona/narrator.js';
import {
  applyEmotionalInertia,
  applyNegativityBias,
  applyBaselineReversion,
  applyTraitBaselineReversion,
  applyStateToTraitInfluence,
  traitToStateBaseline,
  hedonicAdaptation,
  clamp,
} from '../persona/mechanisms.js';
import { generateEmbedding, embeddingToBuffer } from '../memory/embedding.js';
import { randomUUID } from 'node:crypto';
import type {
  OceanTraits, PersonaTraits, PersonaState, PadState,
  RelationshipPattern, ConversationMessage, SentimentAnalysis,
  EvolutionConfig, EvolutionLayer, TriggerType, LlmConfig,
  EvolutionRecord,
} from '../types.js';
import { DEFAULT_OCEAN, DEFAULT_EVOLUTION_CONFIG } from '../types.js';

export interface RecallResult {
  message: ConversationMessage;
  relevance: number;
  source: 'fts' | 'vec' | 'like';
}

export interface MessageInput {
  role: 'user' | 'assistant';
  content: string;
  platform?: string;
  sessionId?: string | null;
  timestamp?: number;
  metadata?: Record<string, unknown> | null;
}

export interface EvolveResult {
  analysis: SentimentAnalysis;
  analysisMethod: 'llm' | 'rules';
  previousState: PadState;
  newState: PersonaState;
  traitChanged: boolean;
  newTraits: PersonaTraits | null;
}

export interface EngineMetrics {
  uptimeMs: number;
  startedAt: number;
  messageCount: number;
  evolveCount: number;
  errorCount: number;
  lastEvolveAt: number | null;
  lastError: { message: string; timestamp: number } | null;
  dbSizeBytes: number;
  vecEnabled: boolean;
  llmProvider: string | null;
}

export interface EvolutionAnalytics {
  total: number;
  stateCount: number;
  traitCount: number;
  recentTrend: { pleasure: string; arousal: string; dominance: string };
  volatility: { pleasure: number; arousal: number; dominance: number };
  triggerBreakdown: { conversation: number; manual: number; decay: number };
  lastEvolutionAt: string | null;
}

export class PersonaEngine {
  private db: Database.Database;
  private vecEnabled: boolean = false;
  private llmConfig: LlmConfig | null = null;
  private config: EvolutionConfig;

  // 运行时指标
  private startedAt = Date.now();
  private evolveCount = 0;
  private errorCount = 0;
  private lastEvolveAt: number | null = null;
  private lastError: { message: string; timestamp: number } | null = null;

  constructor(dbPath: string) {
    // 确保目录存在
    const dir = resolve(dbPath, '..');
    mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    initSchema(this.db);
    this.config = { ...DEFAULT_EVOLUTION_CONFIG };
  }

  /**
   * 异步初始化 sqlite-vec（需要动态 import）
   * 构造后必须调用一次
   */
  async initVec(): Promise<boolean> {
    try {
      const sqliteVec = await import('sqlite-vec');
      sqliteVec.load(this.db);
      this.vecEnabled = initVecSchema(this.db);
    } catch {
      this.vecEnabled = false;
    }
    return this.vecEnabled;
  }

  /** 获取底层 DB 实例（供测试或高级用途） */
  getDb(): Database.Database {
    return this.db;
  }

  /** sqlite-vec 是否可用 */
  isVecEnabled(): boolean {
    return this.vecEnabled;
  }

  // ============================================================
  // 人格管理
  // ============================================================

  initPersona(
    name?: string,
    description?: string,
    ocean?: Partial<OceanTraits>,
  ): PersonaTraits {
    const traits: OceanTraits = { ...DEFAULT_OCEAN, ...ocean };
    const result = upsertTraits(this.db, traits, traits, name, description);
    initStateIfNeeded(this.db);
    log('INFO', 'persona', `init name=${name ?? '(default)'} O=${traits.openness} C=${traits.conscientiousness} E=${traits.extraversion} A=${traits.agreeableness} N=${traits.neuroticism}`);
    return result;
  }

  getTraits(): PersonaTraits | null {
    return getTraits(this.db);
  }

  getState(): PersonaState | null {
    return getState(this.db);
  }

  getRelationship(): RelationshipPattern {
    return getRelationship(this.db);
  }

  // ============================================================
  // 对话记录与检索
  // ============================================================

  async recordMessage(msg: MessageInput): Promise<ConversationMessage> {
    const id = randomUUID();
    log('INFO', 'record', `[${msg.role}] platform=${msg.platform ?? 'unknown'} len=${msg.content.length} "${msg.content.slice(0, 60)}${msg.content.length > 60 ? '...' : ''}"`);
    const record = {
      id,
      role: msg.role,
      content: msg.content,
      platform: msg.platform ?? 'unknown',
      sessionId: msg.sessionId ?? null,
      timestamp: msg.timestamp ?? Date.now(),
      metadata: msg.metadata ?? null,
    };

    const result = this.db.prepare(`
      INSERT INTO conversations (id, platform, session_id, role, content, timestamp, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id, record.platform, record.sessionId, record.role,
      record.content, record.timestamp,
      record.metadata ? JSON.stringify(record.metadata) : null,
    );

    // 异步写入向量
    if (this.vecEnabled) {
      const rowid = BigInt(result.lastInsertRowid);
      try {
        const embedding = await generateEmbedding(record.content, this.llmConfig);
        this.db.prepare('INSERT INTO conversation_vec(rowid, embedding) VALUES (?, ?)').run(
          rowid, embeddingToBuffer(embedding),
        );
      } catch (err: any) {
        // 向量写入失败不影响主流程
        this.errorCount++;
        this.lastError = { message: err?.message ?? 'vec write failed', timestamp: Date.now() };
        log('WARN', 'record', `vec write failed: ${err?.message}`);
      }
    }

    return record as ConversationMessage;
  }

  getMessageCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM conversations').get() as any;
    return row.cnt;
  }

  getRecentMessages(limit: number = 20, platform?: string): ConversationMessage[] {
    const sql = platform
      ? 'SELECT * FROM conversations WHERE platform = ? ORDER BY timestamp DESC LIMIT ?'
      : 'SELECT * FROM conversations ORDER BY timestamp DESC LIMIT ?';
    const params = platform ? [platform, limit] : [limit];
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.reverse().map(rowToMessage);
  }

  getRecentUserMessages(limit: number): Array<{ role: string; content: string }> {
    const rows = this.db.prepare(`
      SELECT role, content FROM conversations
      ORDER BY timestamp DESC LIMIT ?
    `).all(limit) as Array<{ role: string; content: string }>;
    return rows.reverse();
  }

  async recall(query: string, limit: number = 10): Promise<RecallResult[]> {
    const q = query.trim();
    if (!q) return [];

    const candidates = new Map<number, RecallResult>();
    const now = Date.now();
    const DAY_MS = 86400_000;

    // 1. FTS5
    if (q.length >= 3) {
      try {
        const rows = this.db.prepare(`
          SELECT c.rowid, c.id, c.platform, c.session_id, c.role, c.content, c.timestamp, c.metadata,
            f.rank AS fts_rank
          FROM conversation_fts f
          JOIN conversations c ON c.rowid = f.rowid
          WHERE conversation_fts MATCH ?
          ORDER BY f.rank LIMIT ?
        `).all(q, limit * 2) as any[];

        for (const row of rows) {
          const age = (now - row.timestamp) / DAY_MS;
          const timeDecay = Math.exp(-0.023 * age);
          const textRelevance = 1 / (1 + Math.abs(row.fts_rank));
          candidates.set(row.rowid, {
            message: rowToMessage(row),
            relevance: textRelevance * 0.5 + timeDecay * 0.3,
            source: 'fts',
          });
        }
      } catch { /* FTS 语法错误 */ }
    }

    // 2. 向量语义
    if (this.vecEnabled) {
      try {
        const queryEmbedding = await generateEmbedding(q, this.llmConfig);
        const queryBuf = embeddingToBuffer(queryEmbedding);
        const rows = this.db.prepare(`
          SELECT v.rowid, v.distance,
            c.id, c.platform, c.session_id, c.role, c.content, c.timestamp, c.metadata
          FROM conversation_vec v
          JOIN conversations c ON c.rowid = v.rowid
          WHERE embedding MATCH ? AND k = ?
          ORDER BY distance
        `).all(queryBuf, limit * 2) as any[];

        for (const row of rows) {
          const age = (now - row.timestamp) / DAY_MS;
          const timeDecay = Math.exp(-0.023 * age);
          const similarity = 1 / (1 + row.distance);
          const relevance = similarity * 0.5 + timeDecay * 0.3;
          const existing = candidates.get(row.rowid);
          if (existing) {
            existing.relevance = Math.max(existing.relevance, relevance) + 0.2;
          } else {
            candidates.set(row.rowid, { message: rowToMessage(row), relevance, source: 'vec' });
          }
        }
      } catch { /* 向量检索失败 */ }
    }

    // 3. LIKE 降级
    if (candidates.size === 0) {
      const rows = this.db.prepare(`
        SELECT rowid, id, platform, session_id, role, content, timestamp, metadata
        FROM conversations WHERE content LIKE ? ORDER BY timestamp DESC LIMIT ?
      `).all(`%${q}%`, limit * 2) as any[];

      for (const row of rows) {
        const age = (now - row.timestamp) / DAY_MS;
        const timeDecay = Math.exp(-0.023 * age);
        candidates.set(row.rowid, {
          message: rowToMessage(row),
          relevance: 0.4 + timeDecay * 0.3,
          source: 'like',
        });
      }
    }

    const results = Array.from(candidates.values());
    results.sort((a, b) => b.relevance - a.relevance);
    return results.slice(0, limit);
  }

  // ============================================================
  // 演化
  // ============================================================

  async evolve(
    recentMessages?: Array<{ role: string; content: string }>,
    triggerType: TriggerType = 'conversation',
  ): Promise<EvolveResult> {
    const messages = recentMessages ?? this.getRecentUserMessages(this.config.evolveEveryN);
    const traits = initTraitsIfNeeded(this.db);
    const currentState = initStateIfNeeded(this.db);
    const relationship = getRelationship(this.db);

    // 1. 情感分析
    let analysis: SentimentAnalysis;
    let analysisMethod: 'llm' | 'rules';
    if (this.llmConfig && this.llmConfig.provider !== 'none') {
      try {
        analysis = await analyzeByLlm(messages, this.llmConfig);
        analysisMethod = 'llm';
      } catch (err: any) {
        this.errorCount++;
        this.lastError = { message: err?.message ?? 'llm analysis failed', timestamp: Date.now() };
        log('WARN', 'evolve', `LLM analysis failed, falling back to rules: ${err?.message}`);
        analysis = analyzeByRules(messages);
        analysisMethod = 'rules';
      }
    } else {
      analysis = analyzeByRules(messages);
      analysisMethod = 'rules';
    }

    // 2. State 基线
    const traitBaseline = traitToStateBaseline(traits);
    const relationshipBonus: PadState = {
      pleasure: relationship.avgTone * 0.15,
      arousal: relationship.interactionStyle === 'playful' ? 0.1 : 0,
      dominance: relationship.trustLevel > 0.7 ? 0.05 : -0.05,
    };
    const stateBaseline: PadState = {
      pleasure: clamp(traitBaseline.pleasure + relationshipBonus.pleasure, -1, 1),
      arousal: clamp(traitBaseline.arousal + relationshipBonus.arousal, -1, 1),
      dominance: clamp(traitBaseline.dominance + relationshipBonus.dominance, -1, 1),
    };

    // 3. 消极偏差
    const biasedDelta = applyNegativityBias(analysis.suggestedStateDelta, this.config.negativityBias);

    // 4. 享乐适应
    const recentSentiments = this.getRecentSentiments(10);
    const repeatCount = countSameDirection(recentSentiments, analysis.topicSentiment);
    const adaptationFactor = hedonicAdaptation(repeatCount, this.config.hedonicAdaptationFactor);
    const adaptedDelta: PadState = {
      pleasure: biasedDelta.pleasure * adaptationFactor,
      arousal: biasedDelta.arousal * adaptationFactor,
      dominance: biasedDelta.dominance * adaptationFactor,
    };

    // 5. 基线回归 + delta
    const reverted = applyBaselineReversion(currentState, stateBaseline, this.config.stateDecayRate);
    const targetState: PadState = {
      pleasure: clamp(reverted.pleasure + adaptedDelta.pleasure, -1, 1),
      arousal: clamp(reverted.arousal + adaptedDelta.arousal, -1, 1),
      dominance: clamp(reverted.dominance + adaptedDelta.dominance, -1, 1),
    };

    // 6. 情绪惯性
    const smoothedState = applyEmotionalInertia(currentState, targetState, this.config.emotionalInertia);

    // 7. 保存
    const previousState: PadState = { pleasure: currentState.pleasure, arousal: currentState.arousal, dominance: currentState.dominance };
    const newState = upsertState(this.db, smoothedState);

    // 8. 记录历史
    const summary = summarizeAnalysis(analysis, analysisMethod, adaptationFactor);
    this.recordEvolution('state', smoothedState, triggerType, summary);

    // 9. 更新关系
    updateRelationship(this.db, analysis);

    // 10. State → Trait 累积影响
    let traitChanged = false;
    let newTraits: PersonaTraits | null = null;
    const stateHistory = this.getRecentStateHistory(this.config.stateToTraitThreshold);
    if (stateHistory.length >= this.config.stateToTraitThreshold) {
      const avgState = averageStates(stateHistory);
      if (Math.abs(avgState.pleasure) > 0.15 || Math.abs(avgState.arousal) > 0.15) {
        const updatedTraits = applyStateToTraitInfluence(traits, avgState, this.config.stateToTraitRate);
        const daysSinceUpdate = (Date.now() - traits.updatedAt) / (1000 * 60 * 60 * 24);
        const finalTraits = applyTraitBaselineReversion(updatedTraits, traits.baseline, this.config.traitDecayRate, daysSinceUpdate);
        updateTraitValues(this.db, finalTraits);
        this.recordEvolution('trait', finalTraits, triggerType, 'State 累积影响 Trait');
        traitChanged = true;
        newTraits = getTraits(this.db);
      }
    }

    log('INFO', 'evolve', `method=${analysisMethod} trigger=${triggerType} P:${previousState.pleasure.toFixed(3)}→${newState.pleasure.toFixed(3)} A:${previousState.arousal.toFixed(3)}→${newState.arousal.toFixed(3)} D:${previousState.dominance.toFixed(3)}→${newState.dominance.toFixed(3)}${traitChanged ? ' TRAIT_CHANGED' : ''}`);
    log('DEBUG', 'evolve', `analysis=${JSON.stringify(analysis)} adaptedDelta=${JSON.stringify(adaptedDelta)} smoothedState=${JSON.stringify(smoothedState)}`);

    // 运行时指标
    this.evolveCount++;
    this.lastEvolveAt = Date.now();

    return { analysis, analysisMethod, previousState, newState, traitChanged, newTraits };
  }

  /** 仅执行基线回归（无新对话时的衰减） */
  decayState(): PersonaState {
    const traits = initTraitsIfNeeded(this.db);
    const currentState = initStateIfNeeded(this.db);
    const stateBaseline = traitToStateBaseline(traits);
    const reverted = applyBaselineReversion(currentState, stateBaseline, this.config.stateDecayRate);
    const newState = upsertState(this.db, reverted);
    this.recordEvolution('state', reverted, 'decay', '无刺激基线回归');
    log('INFO', 'decay', `P:${currentState.pleasure.toFixed(3)}→${newState.pleasure.toFixed(3)} A:${currentState.arousal.toFixed(3)}→${newState.arousal.toFixed(3)}`);
    return newState;
  }

  /**
   * 记录消息并在达到阈值时自动触发演化
   * 返回 evolve 结果（如果触发了的话）
   */
  async recordAndMaybeEvolve(msg: MessageInput): Promise<{ message: ConversationMessage; evolveResult?: EvolveResult }> {
    const message = await this.recordMessage(msg);
    const count = this.getMessageCount();
    let evolveResult: EvolveResult | undefined;

    if (count > 0 && count % this.config.evolveEveryN === 0) {
      log('INFO', 'auto-evolve', `triggered at msg #${count} (every ${this.config.evolveEveryN})`);
      // 只分析最近 evolveEveryN 条消息（当前会话窗口），避免历史消息污染
      const recent = this.getRecentMessages(this.config.evolveEveryN).map(m => ({ role: m.role, content: m.content }));
      evolveResult = await this.evolve(recent);
    }

    return { message, evolveResult };
  }

  // ============================================================
  // 状态输出
  // ============================================================

  narrateState(format: 'prompt' | 'json' = 'prompt'): string {
    const traits = initTraitsIfNeeded(this.db);
    const state = initStateIfNeeded(this.db);
    const relationship = getRelationship(this.db);

    if (format === 'json') {
      return JSON.stringify({
        traits, state, relationship,
        config: {
          evolution: this.config,
          llm: this.llmConfig ? { provider: this.llmConfig.provider, model: this.llmConfig.model } : null,
        },
      }, null, 2);
    }

    return narrateFullState(traits, state, relationship);
  }

  narrateBrief(): string {
    const state = initStateIfNeeded(this.db);
    return narrateBrief(state);
  }

  getHistory(layer: 'trait' | 'state' | 'all' = 'all', limit: number = 20): EvolutionRecord[] {
    const sql = layer === 'all'
      ? 'SELECT * FROM evolution_history ORDER BY timestamp DESC LIMIT ?'
      : 'SELECT * FROM evolution_history WHERE layer = ? ORDER BY timestamp DESC LIMIT ?';
    const params = layer === 'all' ? [limit] : [layer, limit];
    const rows = this.db.prepare(sql).all(...params) as any[];

    return rows.reverse().map(row => ({
      id: row.id,
      layer: row.layer as EvolutionLayer,
      values: JSON.parse(row.values_json),
      triggerType: row.trigger_type as TriggerType,
      triggerSummary: row.trigger_summary,
      timestamp: row.timestamp,
    }));
  }

  // ============================================================
  // 配置
  // ============================================================

  setLlmConfig(config: LlmConfig | null): void {
    this.llmConfig = config;
  }

  getLlmConfig(): LlmConfig | null {
    return this.llmConfig;
  }

  getConfig(): EvolutionConfig {
    return { ...this.config };
  }

  updateConfig(partial: Partial<EvolutionConfig>): EvolutionConfig {
    this.config = { ...this.config, ...partial };
    return this.getConfig();
  }

  // ============================================================
  // 可观测性
  // ============================================================

  getMetrics(): EngineMetrics {
    const pageCount = (this.db.pragma('page_count') as Array<{ page_count: number }>)[0]?.page_count ?? 0;
    const pageSize = (this.db.pragma('page_size') as Array<{ page_size: number }>)[0]?.page_size ?? 0;
    return {
      uptimeMs: Date.now() - this.startedAt,
      startedAt: this.startedAt,
      messageCount: this.getMessageCount(),
      evolveCount: this.evolveCount,
      errorCount: this.errorCount,
      lastEvolveAt: this.lastEvolveAt,
      lastError: this.lastError,
      dbSizeBytes: pageCount * pageSize,
      vecEnabled: this.vecEnabled,
      llmProvider: this.llmConfig?.provider ?? null,
    };
  }

  getEvolutionAnalytics(): EvolutionAnalytics {
    // 总数统计
    const totalRow = this.db.prepare('SELECT COUNT(*) as cnt FROM evolution_history').get() as any;
    const stateRow = this.db.prepare("SELECT COUNT(*) as cnt FROM evolution_history WHERE layer = 'state'").get() as any;
    const traitRow = this.db.prepare("SELECT COUNT(*) as cnt FROM evolution_history WHERE layer = 'trait'").get() as any;

    // 触发分布
    const triggerRows = this.db.prepare(
      'SELECT trigger_type, COUNT(*) as cnt FROM evolution_history GROUP BY trigger_type'
    ).all() as Array<{ trigger_type: string; cnt: number }>;
    const triggerBreakdown = { conversation: 0, manual: 0, decay: 0 };
    for (const r of triggerRows) {
      if (r.trigger_type in triggerBreakdown) {
        (triggerBreakdown as any)[r.trigger_type] = r.cnt;
      }
    }

    // 最近 10 条 state 记录用于趋势和波动性
    const recentStates = this.getRecentStateHistory(10);

    // 趋势：前半 vs 后半均值
    const recentTrend = { pleasure: 'stable', arousal: 'stable', dominance: 'stable' };
    const volatility = { pleasure: 0, arousal: 0, dominance: 0 };

    if (recentStates.length >= 4) {
      const mid = Math.floor(recentStates.length / 2);
      // recentStates 是 DESC 排序后 reverse 的，即最旧在前
      // 但 getRecentStateHistory 返回的是 DESC 顺序（最新在前）
      const older = recentStates.slice(0, mid);
      const newer = recentStates.slice(mid);
      const olderAvg = averageStates(older);
      const newerAvg = averageStates(newer);

      for (const dim of ['pleasure', 'arousal', 'dominance'] as const) {
        const delta = newerAvg[dim] - olderAvg[dim];
        recentTrend[dim] = delta > 0.02 ? 'rising' : delta < -0.02 ? 'falling' : 'stable';
      }
    }

    // 波动性：标准差
    if (recentStates.length >= 2) {
      const avg = averageStates(recentStates);
      for (const dim of ['pleasure', 'arousal', 'dominance'] as const) {
        const variance = recentStates.reduce((sum, s) => sum + (s[dim] - avg[dim]) ** 2, 0) / recentStates.length;
        volatility[dim] = Math.sqrt(variance);
      }
    }

    // 最后演化时间
    const lastRow = this.db.prepare('SELECT timestamp FROM evolution_history ORDER BY timestamp DESC LIMIT 1').get() as any;
    const lastEvolutionAt = lastRow ? new Date(lastRow.timestamp).toISOString() : null;

    return {
      total: totalRow.cnt,
      stateCount: stateRow.cnt,
      traitCount: traitRow.cnt,
      recentTrend,
      volatility,
      triggerBreakdown,
      lastEvolutionAt,
    };
  }

  // ============================================================
  // 生命周期
  // ============================================================

  close(): void {
    this.db.close();
  }

  // ============================================================
  // 私有辅助
  // ============================================================

  private recordEvolution(
    layer: EvolutionLayer,
    values: OceanTraits | PadState,
    triggerType: TriggerType,
    summary: string | null,
  ): void {
    this.db.prepare(`
      INSERT INTO evolution_history (layer, values_json, trigger_type, trigger_summary, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(layer, JSON.stringify(values), triggerType, summary, Date.now());
  }

  private getRecentStateHistory(limit: number): PadState[] {
    const rows = this.db.prepare(`
      SELECT values_json FROM evolution_history
      WHERE layer = 'state' ORDER BY timestamp DESC LIMIT ?
    `).all(limit) as Array<{ values_json: string }>;
    return rows.map(r => JSON.parse(r.values_json) as PadState);
  }

  private getRecentSentiments(limit: number): string[] {
    const rows = this.db.prepare(`
      SELECT trigger_summary FROM evolution_history
      WHERE layer = 'state' AND trigger_type = 'conversation'
      ORDER BY timestamp DESC LIMIT ?
    `).all(limit) as Array<{ trigger_summary: string | null }>;
    return rows.map(r => r.trigger_summary || 'neutral');
  }
}

// ---- 辅助函数 ----

function rowToMessage(row: any): ConversationMessage {
  return {
    id: row.id,
    platform: row.platform,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  };
}

function countSameDirection(recentSummaries: string[], currentSentiment: string): number {
  let count = 0;
  for (const s of recentSummaries) {
    if (currentSentiment === 'positive' && s.includes('positive')) count++;
    else if (currentSentiment === 'negative' && s.includes('negative')) count++;
    else break;
  }
  return count;
}

function averageStates(states: PadState[]): PadState {
  const n = states.length;
  if (n === 0) return { pleasure: 0, arousal: 0, dominance: 0 };
  const sum = states.reduce(
    (acc, s) => ({ pleasure: acc.pleasure + s.pleasure, arousal: acc.arousal + s.arousal, dominance: acc.dominance + s.dominance }),
    { pleasure: 0, arousal: 0, dominance: 0 },
  );
  return { pleasure: sum.pleasure / n, arousal: sum.arousal / n, dominance: sum.dominance / n };
}

function summarizeAnalysis(a: SentimentAnalysis, method: 'llm' | 'rules', adaptationFactor: number): string {
  const parts: string[] = [`[${method}]`];
  if (a.topicSentiment !== 'neutral') parts.push(`话题情感: ${a.topicSentiment}`);
  if (a.notableEvents.length > 0) parts.push(a.notableEvents.join('; '));
  if (a.interactionQuality !== 'neutral') parts.push(`互动质量: ${a.interactionQuality}`);
  if (adaptationFactor < 0.9) parts.push(`享乐适应: ${(adaptationFactor * 100).toFixed(0)}%`);
  return parts.join(' | ') || '常规对话';
}
