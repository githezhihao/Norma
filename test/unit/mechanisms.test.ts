import { describe, it, expect } from 'vitest';
import {
  applyEmotionalInertia,
  applyNegativityBias,
  applyBaselineReversion,
  applyTraitBaselineReversion,
  applyStateToTraitInfluence,
  traitToStateBaseline,
  hedonicAdaptation,
  clamp,
} from '@/persona/mechanisms.js';
import type { PadState, OceanTraits } from '@/types.js';

describe('clamp', () => {
  it('clamps within range', () => {
    expect(clamp(1.5, -1, 1)).toBe(1);
    expect(clamp(-2, -1, 1)).toBe(-1);
    expect(clamp(0.5, -1, 1)).toBe(0.5);
  });
});

describe('情绪惯性 (Emotional Inertia)', () => {
  it('blends current and target state by inertia factor', () => {
    const current: PadState = { pleasure: 0.8, arousal: 0.0, dominance: 0.0 };
    const target: PadState = { pleasure: -0.2, arousal: 0.5, dominance: 0.3 };
    const result = applyEmotionalInertia(current, target, 0.6);

    // 0.6 * 0.8 + 0.4 * (-0.2) = 0.48 - 0.08 = 0.40
    expect(result.pleasure).toBeCloseTo(0.40, 2);
    // 0.6 * 0.0 + 0.4 * 0.5 = 0.20
    expect(result.arousal).toBeCloseTo(0.20, 2);
    // 0.6 * 0.0 + 0.4 * 0.3 = 0.12
    expect(result.dominance).toBeCloseTo(0.12, 2);
  });

  it('with inertia=0, jumps directly to target', () => {
    const current: PadState = { pleasure: 0.8, arousal: 0.0, dominance: 0.0 };
    const target: PadState = { pleasure: -0.5, arousal: 0.5, dominance: 0.3 };
    const result = applyEmotionalInertia(current, target, 0);
    expect(result.pleasure).toBeCloseTo(-0.5, 2);
  });

  it('with inertia=1, stays at current', () => {
    const current: PadState = { pleasure: 0.8, arousal: 0.2, dominance: -0.1 };
    const target: PadState = { pleasure: -0.5, arousal: 0.5, dominance: 0.3 };
    const result = applyEmotionalInertia(current, target, 1);
    expect(result.pleasure).toBeCloseTo(0.8, 2);
    expect(result.arousal).toBeCloseTo(0.2, 2);
  });

  it('clamps output to [-1, 1]', () => {
    const current: PadState = { pleasure: 0.9, arousal: 0, dominance: 0 };
    const target: PadState = { pleasure: 1.5, arousal: 0, dominance: 0 };
    const result = applyEmotionalInertia(current, target, 0.3);
    expect(result.pleasure).toBeLessThanOrEqual(1);
  });
});

describe('消极偏差 (Negativity Bias)', () => {
  it('amplifies negative values by bias factor', () => {
    const delta: PadState = { pleasure: -0.2, arousal: -0.1, dominance: 0.3 };
    const result = applyNegativityBias(delta, 2.5);

    expect(result.pleasure).toBeCloseTo(-0.5, 2);  // -0.2 * 2.5
    expect(result.arousal).toBeCloseTo(-0.25, 2);   // -0.1 * 2.5
    expect(result.dominance).toBeCloseTo(0.3, 2);   // positive unchanged
  });

  it('leaves positive values unchanged', () => {
    const delta: PadState = { pleasure: 0.4, arousal: 0.2, dominance: 0.1 };
    const result = applyNegativityBias(delta, 3.0);
    expect(result.pleasure).toBeCloseTo(0.4, 2);
    expect(result.arousal).toBeCloseTo(0.2, 2);
  });
});

describe('基线回归 (Baseline Reversion)', () => {
  it('pulls state toward baseline', () => {
    const current: PadState = { pleasure: 0.8, arousal: -0.5, dominance: 0.0 };
    const baseline: PadState = { pleasure: 0.2, arousal: 0.0, dominance: 0.0 };
    const result = applyBaselineReversion(current, baseline, 0.1);

    // pleasure: 0.8 + 0.1 * (0.2 - 0.8) = 0.8 - 0.06 = 0.74
    expect(result.pleasure).toBeCloseTo(0.74, 2);
    // arousal: -0.5 + 0.1 * (0 - (-0.5)) = -0.5 + 0.05 = -0.45
    expect(result.arousal).toBeCloseTo(-0.45, 2);
  });

  it('no change when already at baseline', () => {
    const baseline: PadState = { pleasure: 0.2, arousal: 0.0, dominance: 0.0 };
    const result = applyBaselineReversion(baseline, baseline, 0.1);
    expect(result.pleasure).toBeCloseTo(0.2, 5);
  });
});

describe('Trait 基线回归', () => {
  it('reverts traits toward user baseline over days', () => {
    const current: OceanTraits = {
      openness: 0.9, conscientiousness: 0.7, extraversion: 0.5,
      agreeableness: 0.7, neuroticism: 0.3,
    };
    const baseline: OceanTraits = {
      openness: 0.7, conscientiousness: 0.7, extraversion: 0.5,
      agreeableness: 0.7, neuroticism: 0.3,
    };
    const result = applyTraitBaselineReversion(current, baseline, 0.002, 10);

    // openness: 0.9 + 0.002*10 * (0.7 - 0.9) = 0.9 + 0.02 * (-0.2) = 0.9 - 0.004 = 0.896
    expect(result.openness).toBeCloseTo(0.896, 3);
    // unchanged dimensions stay the same
    expect(result.conscientiousness).toBeCloseTo(0.7, 5);
  });

  it('clamps to [0, 1]', () => {
    const current: OceanTraits = {
      openness: 0.01, conscientiousness: 0.99, extraversion: 0.5,
      agreeableness: 0.5, neuroticism: 0.5,
    };
    const baseline: OceanTraits = {
      openness: 0.0, conscientiousness: 1.0, extraversion: 0.5,
      agreeableness: 0.5, neuroticism: 0.5,
    };
    const result = applyTraitBaselineReversion(current, baseline, 0.1, 100);
    expect(result.openness).toBeGreaterThanOrEqual(0);
    expect(result.conscientiousness).toBeLessThanOrEqual(1);
  });
});

describe('享乐适应 (Hedonic Adaptation)', () => {
  it('first occurrence has full impact', () => {
    expect(hedonicAdaptation(0, 0.15)).toBeCloseTo(1.0, 5);
  });

  it('impact decreases with repetition', () => {
    const first = hedonicAdaptation(0, 0.15);
    const fifth = hedonicAdaptation(4, 0.15);
    const tenth = hedonicAdaptation(9, 0.15);

    expect(fifth).toBeLessThan(first);
    expect(tenth).toBeLessThan(fifth);
    // 1 / (1 + 4*0.15) = 1/1.6 ≈ 0.625
    expect(fifth).toBeCloseTo(0.625, 2);
    // 1 / (1 + 9*0.15) = 1/2.35 ≈ 0.426
    expect(tenth).toBeCloseTo(0.426, 2);
  });
});

describe('traitToStateBaseline', () => {
  it('high neuroticism lowers pleasure baseline', () => {
    const anxious: OceanTraits = {
      openness: 0.5, conscientiousness: 0.5, extraversion: 0.5,
      agreeableness: 0.5, neuroticism: 0.9,
    };
    const calm: OceanTraits = {
      openness: 0.5, conscientiousness: 0.5, extraversion: 0.5,
      agreeableness: 0.5, neuroticism: 0.1,
    };
    const anxiousBaseline = traitToStateBaseline(anxious);
    const calmBaseline = traitToStateBaseline(calm);
    expect(anxiousBaseline.pleasure).toBeLessThan(calmBaseline.pleasure);
  });

  it('high extraversion raises arousal baseline', () => {
    const extrovert: OceanTraits = {
      openness: 0.5, conscientiousness: 0.5, extraversion: 0.9,
      agreeableness: 0.5, neuroticism: 0.5,
    };
    const introvert: OceanTraits = {
      openness: 0.5, conscientiousness: 0.5, extraversion: 0.1,
      agreeableness: 0.5, neuroticism: 0.5,
    };
    expect(traitToStateBaseline(extrovert).arousal).toBeGreaterThan(
      traitToStateBaseline(introvert).arousal,
    );
  });
});

describe('State → Trait 影响', () => {
  it('sustained positive pleasure increases agreeableness', () => {
    const traits: OceanTraits = {
      openness: 0.5, conscientiousness: 0.5, extraversion: 0.5,
      agreeableness: 0.5, neuroticism: 0.5,
    };
    const happyState: PadState = { pleasure: 0.8, arousal: 0.0, dominance: 0.0 };
    const result = applyStateToTraitInfluence(traits, happyState, 0.05);
    expect(result.agreeableness).toBeGreaterThan(traits.agreeableness);
  });

  it('sustained negative pleasure increases neuroticism', () => {
    const traits: OceanTraits = {
      openness: 0.5, conscientiousness: 0.5, extraversion: 0.5,
      agreeableness: 0.5, neuroticism: 0.5,
    };
    const sadState: PadState = { pleasure: -0.8, arousal: 0.0, dominance: 0.0 };
    const result = applyStateToTraitInfluence(traits, sadState, 0.05);
    expect(result.neuroticism).toBeGreaterThan(traits.neuroticism);
  });
});
