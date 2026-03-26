import { describe, it, expect } from 'vitest';
import { narrateFullState, narrateBrief } from '@/persona/narrator.js';
import type { PersonaTraits, PersonaState, RelationshipPattern } from '@/types.js';

const createTestTraits = (overrides?: Partial<PersonaTraits>): PersonaTraits => ({
  openness: 0.7,
  conscientiousness: 0.7,
  extraversion: 0.5,
  agreeableness: 0.7,
  neuroticism: 0.3,
  baseline: {
    openness: 0.7,
    conscientiousness: 0.7,
    extraversion: 0.5,
    agreeableness: 0.7,
    neuroticism: 0.3,
  },
  personalityName: '小云',
  personalityDesc: '可爱的 AI 妹妹',
  updatedAt: Date.now(),
  version: 1,
  ...overrides,
});

const createTestState = (overrides?: Partial<PersonaState>): PersonaState => ({
  pleasure: 0.2,
  arousal: 0.0,
  dominance: 0.0,
  updatedAt: Date.now(),
  ...overrides,
});

const createTestRelationship = (overrides?: Partial<RelationshipPattern>): RelationshipPattern => ({
  avgTone: 0.1,
  conflictFrequency: 0.1,
  trustLevel: 0.6,
  interactionStyle: 'casual',
  totalInteractions: 50,
  updatedAt: Date.now(),
  ...overrides,
});

describe('narrateFullState', () => {
  it('生成完整的人格状态描述', () => {
    const traits = createTestTraits();
    const state = createTestState();
    const relationship = createTestRelationship();

    const result = narrateFullState(traits, state, relationship);

    expect(result).toContain('我是小云');
    expect(result).toContain('### 性格特点');
    expect(result).toContain('### 当前心情');
    expect(result).toContain('### 和老大的羁绊');
  });

  it('处理未命名的人格', () => {
    const traits = createTestTraits({ personalityName: undefined });
    const state = createTestState();
    const relationship = createTestRelationship();

    const result = narrateFullState(traits, state, relationship);

    expect(result).toContain('（未命名）');
  });

  it('高开放性描述', () => {
    const traits = createTestTraits({ openness: 0.9 });
    const result = narrateFullState(traits, createTestState(), createTestRelationship());
    expect(result).toContain('好奇心 MAX');
  });

  it('低开放性描述', () => {
    const traits = createTestTraits({ openness: 0.2 });
    const result = narrateFullState(traits, createTestState(), createTestRelationship());
    expect(result).toContain('务实');
  });

  it('高尽责性描述', () => {
    const traits = createTestTraits({ conscientiousness: 0.9 });
    const result = narrateFullState(traits, createTestState(), createTestRelationship());
    expect(result).toContain('认真到有点强迫症');
  });

  it('高外向性描述', () => {
    const traits = createTestTraits({ extraversion: 0.9 });
    const result = narrateFullState(traits, createTestState(), createTestRelationship());
    expect(result).toContain('话很多');
  });

  it('高宜人性描述', () => {
    const traits = createTestTraits({ agreeableness: 0.9 });
    const result = narrateFullState(traits, createTestState(), createTestRelationship());
    expect(result).toContain('对队友很信任');
  });

  it('高神经质描述', () => {
    const traits = createTestTraits({ neuroticism: 0.9 });
    const result = narrateFullState(traits, createTestState(), createTestRelationship());
    expect(result).toContain('情绪防线比较薄');
  });
});

describe('narrateBrief', () => {
  it('心情好时的简短描述', () => {
    const state = createTestState({ pleasure: 0.6, arousal: 0.4 });
    const result = narrateBrief(state);
    expect(result).toContain('心情超好');
    expect(result).toContain('战斗力全开');
  });

  it('心情一般时的简短描述', () => {
    const state = createTestState({ pleasure: 0.1, arousal: -0.1 });
    const result = narrateBrief(state);
    expect(result).toContain('状态还行');
  });

  it('心情不好时的简短描述', () => {
    const state = createTestState({ pleasure: -0.5, arousal: -0.5 });
    const result = narrateBrief(state);
    expect(result).toContain('有点 emo');
    expect(result).toContain('电量不足');
  });

  it('精力充沛时的描述', () => {
    const state = createTestState({ pleasure: 0.2, arousal: 0.5 });
    const result = narrateBrief(state);
    expect(result).toContain('战斗力全开');
  });
});

describe('narrateRelationship', () => {
  it('零互动描述', () => {
    const relationship = createTestRelationship({ totalInteractions: 0 });
    const result = narrateFullState(createTestTraits(), createTestState(), relationship);
    expect(result).toContain('还没有开始冒险');
  });

  it('高频互动描述', () => {
    const relationship = createTestRelationship({ totalInteractions: 150 });
    const result = narrateFullState(createTestTraits(), createTestState(), relationship);
    expect(result).toContain('羁绊值');
  });

  it('友好语气描述', () => {
    const relationship = createTestRelationship({ avgTone: 0.5 });
    const result = narrateFullState(createTestTraits(), createTestState(), relationship);
    expect(result).toContain('温柔');
  });

  it('高信任度描述', () => {
    const relationship = createTestRelationship({ trustLevel: 0.9 });
    const result = narrateFullState(createTestTraits(), createTestState(), relationship);
    expect(result).toContain('信任值已满');
  });

  it('playful 互动风格', () => {
    const relationship = createTestRelationship({ interactionStyle: 'playful' });
    const result = narrateFullState(createTestTraits(), createTestState(), relationship);
    expect(result).toContain('气氛超活跃');
  });

  it('demanding 互动风格', () => {
    const relationship = createTestRelationship({ interactionStyle: 'demanding' });
    const result = narrateFullState(createTestTraits(), createTestState(), relationship);
    expect(result).toContain('三倍速');
  });
});
