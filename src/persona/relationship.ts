// ============================================================
// 关系模式追踪
// ============================================================

import type Database from 'better-sqlite3';
import type { RelationshipPattern, SentimentAnalysis } from '../types.js';
import { DEFAULT_RELATIONSHIP } from '../types.js';

export function getRelationship(db: Database.Database): RelationshipPattern {
  const row = db.prepare('SELECT * FROM relationship WHERE id = 1').get() as any;
  if (!row) return { ...DEFAULT_RELATIONSHIP, updatedAt: Date.now() };
  return {
    avgTone: row.avg_tone,
    conflictFrequency: row.conflict_frequency,
    trustLevel: row.trust_level,
    interactionStyle: row.interaction_style,
    totalInteractions: row.total_interactions,
    updatedAt: row.updated_at,
  };
}

export function updateRelationship(
  db: Database.Database,
  analysis: SentimentAnalysis,
): RelationshipPattern {
  const current = getRelationship(db);
  const n = current.totalInteractions;
  const now = Date.now();

  // 滑动平均更新 tone
  const newAvgTone = n === 0
    ? analysis.userTone
    : (current.avgTone * n + analysis.userTone) / (n + 1);

  // 冲突频率：指数移动平均
  const isConflict = analysis.interactionQuality === 'conflictual' || analysis.interactionQuality === 'tense';
  const conflictVal = isConflict ? 1 : 0;
  const alpha = 0.1; // 平滑系数
  const newConflictFreq = current.conflictFrequency * (1 - alpha) + conflictVal * alpha;

  // 信任度：随互动次数缓慢增长，冲突时下降
  let trustDelta = 0.005; // 每次互动微增信任
  if (isConflict) trustDelta = -0.03;
  if (analysis.interactionQuality === 'supportive') trustDelta = 0.01;
  const newTrust = clamp(current.trustLevel + trustDelta, 0, 1);

  // 互动风格推断
  const style = inferStyle(newAvgTone, newConflictFreq, analysis);

  db.prepare(`
    INSERT INTO relationship (id, avg_tone, conflict_frequency, trust_level, interaction_style, total_interactions, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      avg_tone=excluded.avg_tone, conflict_frequency=excluded.conflict_frequency,
      trust_level=excluded.trust_level, interaction_style=excluded.interaction_style,
      total_interactions=excluded.total_interactions, updated_at=excluded.updated_at
  `).run(newAvgTone, newConflictFreq, newTrust, style, n + 1, now);

  return {
    avgTone: newAvgTone,
    conflictFrequency: newConflictFreq,
    trustLevel: newTrust,
    interactionStyle: style,
    totalInteractions: n + 1,
    updatedAt: now,
  };
}

function inferStyle(
  avgTone: number,
  conflictFreq: number,
  analysis: SentimentAnalysis,
): RelationshipPattern['interactionStyle'] {
  if (conflictFreq > 0.3) return 'demanding';
  if (avgTone > 0.3 && analysis.emotionalIntensity > 0.4) return 'playful';
  if (avgTone > 0.1) return 'casual';
  return 'formal';
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
