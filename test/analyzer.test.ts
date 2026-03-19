import { describe, it, expect } from 'vitest';
import { analyzeByRules } from '../src/persona/analyzer.js';

describe('规则降级情感分析器', () => {
  it('returns neutral for empty messages', () => {
    const result = analyzeByRules([]);
    expect(result.userTone).toBe(0);
    expect(result.topicSentiment).toBe('neutral');
  });

  it('detects positive sentiment', () => {
    const result = analyzeByRules([
      { role: 'user', content: '太棒了！谢谢你，做得很好！' },
      { role: 'user', content: '完美，我很满意这个结果' },
    ]);
    expect(result.userTone).toBeGreaterThan(0);
    expect(result.suggestedStateDelta.pleasure).toBeGreaterThan(0);
  });

  it('detects negative sentiment', () => {
    const result = analyzeByRules([
      { role: 'user', content: '这个不行，太差了，完全是错的' },
      { role: 'user', content: '失败了，我很失望' },
    ]);
    expect(result.userTone).toBeLessThan(0);
    expect(result.suggestedStateDelta.pleasure).toBeLessThan(0);
  });

  it('detects high arousal from exclamation marks', () => {
    const calm = analyzeByRules([
      { role: 'user', content: '好的。' },
    ]);
    const excited = analyzeByRules([
      { role: 'user', content: '好的！！！太好了！！！' },
    ]);
    expect(excited.emotionalIntensity).toBeGreaterThan(calm.emotionalIntensity);
  });

  it('short commanding messages shift dominance up', () => {
    const result = analyzeByRules([
      { role: 'user', content: '改一下' },
    ]);
    expect(result.dominanceShift).toBeGreaterThan(0);
  });

  it('long messages shift dominance down', () => {
    const longMsg = '这是一段很长的消息，'.repeat(20);
    const result = analyzeByRules([
      { role: 'user', content: longMsg },
    ]);
    expect(result.dominanceShift).toBeLessThan(0);
  });

  it('filters only user messages', () => {
    const result = analyzeByRules([
      { role: 'assistant', content: '垃圾垃圾垃圾失败失败' },
      { role: 'user', content: '好的' },
    ]);
    // assistant 的负面词不应影响分析
    expect(result.userTone).toBeGreaterThanOrEqual(0);
  });
});
