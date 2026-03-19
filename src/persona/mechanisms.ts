// ============================================================
// 五大心理学机制实现
// 1. 情绪惯性 (Emotional Inertia)
// 2. 消极偏差 (Negativity Bias)
// 3. 基线回归 (Baseline Reversion)
// 4. 享乐适应 (Hedonic Adaptation) — Phase 2
// 5. 关系记忆 (Interpersonal Memory) — Phase 2
// ============================================================

import type { PadState, OceanTraits, EvolutionConfig } from '../types.js';

/** 将值限制在 [min, max] 范围内 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 1. 情绪惯性 — 情绪不会瞬间跳变，从当前值"滑动"到目标值
 *
 * 心理学依据：情绪具有时间连续性，上一刻的情绪状态会影响下一刻。
 * inertia=0.6 意味着 60% 保留当前情绪，40% 接受新分析值。
 */
export function applyEmotionalInertia(
  current: PadState,
  target: PadState,
  inertia: number,
): PadState {
  const blend = (cur: number, tgt: number) =>
    clamp(inertia * cur + (1 - inertia) * tgt, -1, 1);

  return {
    pleasure: blend(current.pleasure, target.pleasure),
    arousal: blend(current.arousal, target.arousal),
    dominance: blend(current.dominance, target.dominance),
  };
}

/**
 * 2. 消极偏差 — 负面事件对情绪的影响是正面事件的 N 倍
 *
 * 心理学依据：Baumeister et al. (2001) "Bad is stronger than good"
 * 人类对负面信息天生更敏感，负面影响约为正面的 2-3 倍。
 */
export function applyNegativityBias(
  delta: PadState,
  bias: number,
): PadState {
  const applyBias = (val: number) =>
    val < 0 ? val * bias : val;

  return {
    pleasure: applyBias(delta.pleasure),
    arousal: applyBias(delta.arousal),
    dominance: applyBias(delta.dominance),
  };
}

/**
 * 3. 基线回归 — 无外部刺激时，情绪缓慢回归到个人基线
 *
 * 心理学依据：情绪的 set-point theory，人有一个"情绪基线"，
 * 偏离后会自然回归。基线由 Trait 层决定。
 *
 * @param current 当前 State
 * @param baseline 由 Trait 层计算出的 State 基线
 * @param decayRate 回归速率 (per turn)，约 0.03
 */
export function applyBaselineReversion(
  current: PadState,
  baseline: PadState,
  decayRate: number,
): PadState {
  const revert = (cur: number, base: number) =>
    clamp(cur + decayRate * (base - cur), -1, 1);

  return {
    pleasure: revert(current.pleasure, baseline.pleasure),
    arousal: revert(current.arousal, baseline.arousal),
    dominance: revert(current.dominance, baseline.dominance),
  };
}

/**
 * Trait 层基线回归 — 无强化时，Trait 极缓慢回归用户初始设定
 *
 * @param current 当前 Trait 值
 * @param userBaseline 用户设定的初始基线
 * @param decayRate 回归速率 (per day)，约 0.002
 * @param daysSinceLastUpdate 距上次更新的天数
 */
export function applyTraitBaselineReversion(
  current: OceanTraits,
  userBaseline: OceanTraits,
  decayRate: number,
  daysSinceLastUpdate: number,
): OceanTraits {
  const effectiveDecay = decayRate * daysSinceLastUpdate;
  const revert = (cur: number, base: number) =>
    clamp(cur + effectiveDecay * (base - cur), 0, 1);

  return {
    openness: revert(current.openness, userBaseline.openness),
    conscientiousness: revert(current.conscientiousness, userBaseline.conscientiousness),
    extraversion: revert(current.extraversion, userBaseline.extraversion),
    agreeableness: revert(current.agreeableness, userBaseline.agreeableness),
    neuroticism: revert(current.neuroticism, userBaseline.neuroticism),
  };
}

/**
 * 4. 享乐适应 — 同类情绪持续出现时，影响力递减
 *
 * 心理学依据：Brickman & Campbell (1971) hedonic treadmill
 * 人会"习惯"持续的刺激，无论正面还是负面。
 *
 * @param repeatCount 同类情绪连续出现的次数
 * @param factor 衰减因子，默认 0.15
 * @returns 适应后的影响力系数 (0, 1]
 */
export function hedonicAdaptation(repeatCount: number, factor: number): number {
  return 1 / (1 + repeatCount * factor);
}

/**
 * 从 Trait 层计算 State 基线
 *
 * Trait 影响情绪的"默认位置"：
 * - 高 Neuroticism → P 基线偏低，A 基线偏高
 * - 高 Extraversion → P 基线偏高，A 基线偏高
 * - 高 Agreeableness → P 基线偏高，D 基线偏低
 */
export function traitToStateBaseline(traits: OceanTraits): PadState {
  return {
    pleasure: clamp(
      0.3 * traits.extraversion + 0.2 * traits.agreeableness - 0.4 * traits.neuroticism + 0.1,
      -1, 1,
    ),
    arousal: clamp(
      0.3 * traits.extraversion + 0.3 * traits.neuroticism - 0.2 * traits.conscientiousness,
      -1, 1,
    ),
    dominance: clamp(
      0.3 * traits.extraversion - 0.2 * traits.agreeableness + 0.2 * traits.conscientiousness - 0.1,
      -1, 1,
    ),
  };
}

/**
 * State 累积影响 Trait — 持续的情绪偏移会缓慢改变人格特质
 *
 * @param traits 当前 Trait
 * @param avgState 最近 N 轮的平均 State
 * @param rate 影响系数
 */
export function applyStateToTraitInfluence(
  traits: OceanTraits,
  avgState: PadState,
  rate: number,
): OceanTraits {
  return {
    openness: clamp(traits.openness + rate * avgState.arousal * 0.3, 0, 1),
    conscientiousness: clamp(traits.conscientiousness + rate * avgState.dominance * 0.2, 0, 1),
    extraversion: clamp(traits.extraversion + rate * (avgState.pleasure + avgState.arousal) * 0.2, 0, 1),
    agreeableness: clamp(traits.agreeableness + rate * avgState.pleasure * 0.3, 0, 1),
    neuroticism: clamp(traits.neuroticism - rate * avgState.pleasure * 0.3 + rate * Math.abs(avgState.arousal) * 0.1, 0, 1),
  };
}
