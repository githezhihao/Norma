import { describe, it, expect } from 'vitest';
import { narrateFullState, narrateBrief } from '../src/persona/narrator.js';
import type { PersonaTraits, PersonaState, RelationshipPattern } from '../src/types.js';

const baseTraits: PersonaTraits = {
  openness: 0.8,
  conscientiousness: 0.75,
  extraversion: 0.4,
  agreeableness: 0.8,
  neuroticism: 0.2,
  baseline: {
    openness: 0.8, conscientiousness: 0.75, extraversion: 0.4,
    agreeableness: 0.8, neuroticism: 0.2,
  },
  personalityName: '小云',
  personalityDesc: '一个好奇心旺盛、做事有条理的助手。',
  updatedAt: Date.now(),
  version: 1,
};

const happyState: PersonaState = {
  pleasure: 0.6, arousal: 0.1, dominance: 0.0, updatedAt: Date.now(),
};

const sadState: PersonaState = {
  pleasure: -0.6, arousal: -0.4, dominance: -0.4, updatedAt: Date.now(),
};

const activeRelationship: RelationshipPattern = {
  avgTone: 0.4,
  conflictFrequency: 0.05,
  trustLevel: 0.85,
  interactionStyle: 'casual',
  totalInteractions: 47,
  updatedAt: Date.now(),
};

const newRelationship: RelationshipPattern = {
  avgTone: 0,
  conflictFrequency: 0,
  trustLevel: 0.5,
  interactionStyle: 'casual',
  totalInteractions: 0,
  updatedAt: Date.now(),
};

describe('narrateFullState', () => {
  it('generates human-readable persona description', () => {
    const text = narrateFullState(baseTraits, happyState, activeRelationship);

    expect(text).toContain('小云');
    expect(text).toContain('好奇心');
    expect(text).toContain('心情');
    expect(text).toContain('47');
    expect(text).toContain('信任');
  });

  it('reflects sad state in mood description', () => {
    const text = narrateFullState(baseTraits, sadState, activeRelationship);
    // 应该包含低落/不好相关的描述（二次元风格）
    expect(text).toMatch(/不好|濒死|暴击|emo|down/);
  });

  it('handles new relationship with zero interactions', () => {
    const text = narrateFullState(baseTraits, happyState, newRelationship);
    expect(text).toMatch(/还没有|第一次/);
  });

  it('does not contain raw numbers like 0.800', () => {
    const text = narrateFullState(baseTraits, happyState, activeRelationship);
    // 自然语言描述不应该有裸数值
    expect(text).not.toMatch(/0\.\d{3}/);
  });
});

describe('narrateBrief', () => {
  it('returns emoji + short description for happy state', () => {
    const brief = narrateBrief(happyState);
    expect(brief).toContain('✨');
    expect(brief.length).toBeLessThan(60);
  });

  it('returns sad emoji for negative pleasure', () => {
    const brief = narrateBrief(sadState);
    expect(brief).toContain('😣');
  });
});
