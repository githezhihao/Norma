// ============================================================
// 双层演化引擎 — 核心调度器
// 协调 Trait 层、State 层、心理学机制、情感分析
// Phase 2: LLM 分析 + 享乐适应 + 关系记忆影响
// ============================================================

import type Database from 'better-sqlite3';
import type {
  PadState, OceanTraits, PersonaTraits, PersonaState,
  SentimentAnalysis, EvolutionConfig, EvolutionLayer, TriggerType,
  LlmConfig,
} from '../types.js';
import { getTraits, updateTraitValues, initTraitsIfNeeded } from './traits.js';
import { getState, upsertState, initStateIfNeeded } from './states.js';
import { getRelationship, updateRelationship } from './relationship.js';
import { analyzeByRules } from './analyzer.js';
import { analyzeByLlm } from './llm-analyzer.js';
import { getConfig } from './config.js';
import {
  applyEmotionalInertia,
  applyNegativityBias,
  applyBaselineReversion,
  applyTraitBaselineReversion,
  applyStateToTraitInfluence,
  traitToStateBaseline,
  hedonicAdaptation,
} from './mechanisms.js';

// LLM 配置（运行时设置）
let llmConfig: LlmConfig | null = null;

export function setLlmConfig(config: LlmConfig | null): void {
  llmConfig = config;
}

export function getLlmConfig(): LlmConfig | null {
  return llmConfig;
}

export interface EvolveResult {
  analysis: SentimentAnalysis;
  analysisMethod: 'llm' | 'rules';
  previousState: PadState;
  newState: PersonaState;
  traitChanged: boolean;
  newTraits: PersonaTraits | null;
}

/**
 * 主演化流程：分析最近的对话 → 更新 State → 可能更新 Trait
 */
export async function evolve(
  db: Database.Database,
  recentMessages: Array<{ role: string; content: string }>,
  triggerType: TriggerType = 'conversation',
): Promise<EvolveResult> {
  const cfg = getConfig();
  const traits = initTraitsIfNeeded(db);
  const currentState = initStateIfNeeded(db);
  const relationship = getRelationship(db);

  // 1. 情感分析（LLM 优先，降级到规则）
  let analysis: SentimentAnalysis;
  let analysisMethod: 'llm' | 'rules';

  if (llmConfig && llmConfig.provider !== 'none') {
    analysis = await analyzeByLlm(recentMessages, llmConfig);
    // 如果 LLM 返回的是降级结果（analyzeByLlm 内部 catch 后调 analyzeByRules），
    // 我们无法区分，但这没关系——降级是透明的
    analysisMethod = 'llm';
  } else {
    analysis = analyzeByRules(recentMessages);
    analysisMethod = 'rules';
  }

  // 2. 计算 State 基线（由 Trait + 关系记忆共同决定）
  const traitBaseline = traitToStateBaseline(traits);
  // 关系记忆影响基线：和友善的用户对话时，P 基线自然偏高
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

  // 3. 应用消极偏差到建议的 delta
  const biasedDelta = applyNegativityBias(analysis.suggestedStateDelta, cfg.negativityBias);

  // 4. 享乐适应：检测同类情绪重复出现，递减影响力
  const recentSentiments = getRecentSentiments(db, 10);
  const repeatCount = countSameDirection(recentSentiments, analysis.topicSentiment);
  const adaptationFactor = hedonicAdaptation(repeatCount, cfg.hedonicAdaptationFactor);
  const adaptedDelta: PadState = {
    pleasure: biasedDelta.pleasure * adaptationFactor,
    arousal: biasedDelta.arousal * adaptationFactor,
    dominance: biasedDelta.dominance * adaptationFactor,
  };

  // 5. 计算目标 State = 基线回归 + 适应后的情感 delta
  const reverted = applyBaselineReversion(currentState, stateBaseline, cfg.stateDecayRate);
  const targetState: PadState = {
    pleasure: clamp(reverted.pleasure + adaptedDelta.pleasure, -1, 1),
    arousal: clamp(reverted.arousal + adaptedDelta.arousal, -1, 1),
    dominance: clamp(reverted.dominance + adaptedDelta.dominance, -1, 1),
  };

  // 6. 应用情绪惯性（平滑过渡）
  const smoothedState = applyEmotionalInertia(currentState, targetState, cfg.emotionalInertia);

  // 7. 保存新 State
  const previousState: PadState = {
    pleasure: currentState.pleasure,
    arousal: currentState.arousal,
    dominance: currentState.dominance,
  };
  const newState = upsertState(db, smoothedState);

  // 8. 记录 State 演化历史
  const summary = summarizeAnalysis(analysis, analysisMethod, adaptationFactor);
  recordEvolution(db, 'state', smoothedState, triggerType, summary);

  // 9. 更新关系模式
  updateRelationship(db, analysis);

  // 10. 检查是否需要更新 Trait（累积影响）
  let traitChanged = false;
  let newTraits: PersonaTraits | null = null;

  const stateHistory = getRecentStateHistory(db, cfg.stateToTraitThreshold);
  if (stateHistory.length >= cfg.stateToTraitThreshold) {
    const avgState = averageStates(stateHistory);
    if (Math.abs(avgState.pleasure) > 0.15 || Math.abs(avgState.arousal) > 0.15) {
      const updatedTraits = applyStateToTraitInfluence(traits, avgState, cfg.stateToTraitRate);

      const daysSinceUpdate = (Date.now() - traits.updatedAt) / (1000 * 60 * 60 * 24);
      const finalTraits = applyTraitBaselineReversion(
        updatedTraits, traits.baseline, cfg.traitDecayRate, daysSinceUpdate,
      );

      updateTraitValues(db, finalTraits);
      recordEvolution(db, 'trait', finalTraits, triggerType, 'State 累积影响 Trait');
      traitChanged = true;
      newTraits = getTraits(db);
    }
  }

  return { analysis, analysisMethod, previousState, newState, traitChanged, newTraits };
}

/**
 * 仅执行基线回归（无新对话时的衰减）
 */
export function decayState(db: Database.Database): PersonaState {
  const cfg = getConfig();
  const traits = initTraitsIfNeeded(db);
  const currentState = initStateIfNeeded(db);
  const stateBaseline = traitToStateBaseline(traits);

  const reverted = applyBaselineReversion(currentState, stateBaseline, cfg.stateDecayRate);
  const newState = upsertState(db, reverted);
  recordEvolution(db, 'state', reverted, 'decay', '无刺激基线回归');
  return newState;
}

// ---- 内部辅助 ----

function recordEvolution(
  db: Database.Database,
  layer: EvolutionLayer,
  values: OceanTraits | PadState,
  triggerType: TriggerType,
  summary: string | null,
): void {
  db.prepare(`
    INSERT INTO evolution_history (layer, values_json, trigger_type, trigger_summary, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `).run(layer, JSON.stringify(values), triggerType, summary, Date.now());
}

function getRecentStateHistory(db: Database.Database, limit: number): PadState[] {
  const rows = db.prepare(`
    SELECT values_json FROM evolution_history
    WHERE layer = 'state'
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(limit) as Array<{ values_json: string }>;

  return rows.map(r => JSON.parse(r.values_json) as PadState);
}

/**
 * 获取最近 N 次演化的情感方向（从 trigger_summary 推断）
 */
function getRecentSentiments(db: Database.Database, limit: number): string[] {
  const rows = db.prepare(`
    SELECT trigger_summary FROM evolution_history
    WHERE layer = 'state' AND trigger_type = 'conversation'
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(limit) as Array<{ trigger_summary: string | null }>;

  return rows.map(r => r.trigger_summary || 'neutral');
}

/**
 * 计算同方向情绪连续出现的次数（用于享乐适应）
 */
function countSameDirection(recentSummaries: string[], currentSentiment: string): number {
  let count = 0;
  for (const s of recentSummaries) {
    if (currentSentiment === 'positive' && s.includes('positive')) count++;
    else if (currentSentiment === 'negative' && s.includes('negative')) count++;
    else break; // 方向变了就停
  }
  return count;
}

function averageStates(states: PadState[]): PadState {
  const n = states.length;
  if (n === 0) return { pleasure: 0, arousal: 0, dominance: 0 };
  const sum = states.reduce(
    (acc, s) => ({
      pleasure: acc.pleasure + s.pleasure,
      arousal: acc.arousal + s.arousal,
      dominance: acc.dominance + s.dominance,
    }),
    { pleasure: 0, arousal: 0, dominance: 0 },
  );
  return {
    pleasure: sum.pleasure / n,
    arousal: sum.arousal / n,
    dominance: sum.dominance / n,
  };
}

function summarizeAnalysis(
  a: SentimentAnalysis,
  method: 'llm' | 'rules',
  adaptationFactor: number,
): string {
  const parts: string[] = [`[${method}]`];
  if (a.topicSentiment !== 'neutral') parts.push(`话题情感: ${a.topicSentiment}`);
  if (a.notableEvents.length > 0) parts.push(a.notableEvents.join('; '));
  if (a.interactionQuality !== 'neutral') parts.push(`互动质量: ${a.interactionQuality}`);
  if (adaptationFactor < 0.9) parts.push(`享乐适应: ${(adaptationFactor * 100).toFixed(0)}%`);
  return parts.join(' | ') || '常规对话';
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
