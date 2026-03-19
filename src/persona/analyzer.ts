// ============================================================
// 规则降级情感分析器（无需 LLM）
// 基于情感词典 + 标点符号 + 消息模式的启发式分析
// ============================================================

import type { SentimentAnalysis, PadState } from '../types.js';

// 中英文情感词典
const POSITIVE_WORDS = new Set([
  // 中文
  '谢谢', '感谢', '棒', '好的', '不错', '厉害', '优秀', '完美', '喜欢', '爱',
  '开心', '高兴', '满意', '赞', '牛', '强', '妙', '帅', '美', '酷',
  '哈哈', '嘻嘻', '嘿嘿', '太好了', '真棒', '辛苦了', '加油',
  // English
  'thanks', 'thank', 'great', 'good', 'nice', 'awesome', 'excellent', 'perfect',
  'love', 'like', 'happy', 'wonderful', 'amazing', 'cool', 'brilliant',
  'well done', 'fantastic', 'impressive', 'beautiful', 'yes', 'exactly',
]);

const NEGATIVE_WORDS = new Set([
  // 中文
  '不行', '不好', '差', '烂', '垃圾', '废', '错', '问题', '失败', '崩溃',
  '生气', '烦', '讨厌', '无语', '难受', '痛苦', '焦虑', '担心', '害怕',
  '不满', '失望', '糟糕', '恶心', '愤怒', '郁闷', '累', '烦死了',
  // English
  'bad', 'wrong', 'error', 'fail', 'terrible', 'awful', 'hate', 'angry',
  'frustrated', 'annoying', 'disappointed', 'worried', 'anxious', 'sad',
  'broken', 'useless', 'stupid', 'ugly', 'no', 'never', 'worst',
]);

const INTENSE_MARKERS = ['!', '！', '?!', '！？', '!!', '！！', '???', '？？？'];
const CALM_MARKERS = ['。', '.', '...', '……', '~', '～'];

/**
 * 基于规则的情感分析（LLM 降级方案）
 */
export function analyzeByRules(messages: Array<{ role: string; content: string }>): SentimentAnalysis {
  const userMessages = messages.filter(m => m.role === 'user');
  if (userMessages.length === 0) {
    return neutralAnalysis();
  }

  let positiveCount = 0;
  let negativeCount = 0;
  let totalIntensity = 0;
  let totalLength = 0;
  const events: string[] = [];

  for (const msg of userMessages) {
    const content = msg.content.toLowerCase();
    totalLength += content.length;

    // 词汇匹配
    for (const word of POSITIVE_WORDS) {
      if (content.includes(word)) positiveCount++;
    }
    for (const word of NEGATIVE_WORDS) {
      if (content.includes(word)) negativeCount++;
    }

    // 标点强度
    let msgIntensity = 0;
    for (const marker of INTENSE_MARKERS) {
      const count = content.split(marker).length - 1;
      msgIntensity += count * 0.15;
    }
    for (const marker of CALM_MARKERS) {
      const count = content.split(marker).length - 1;
      msgIntensity -= count * 0.05;
    }

    // 全大写（英文）= 强烈情绪
    if (msg.content === msg.content.toUpperCase() && /[A-Z]{3,}/.test(msg.content)) {
      msgIntensity += 0.3;
      events.push('用户使用了全大写（强烈情绪）');
    }

    // emoji 检测
    const emojiPositive = (content.match(/[😊😄😁🎉✨👍❤️💪🥰😍🤗]/g) || []).length;
    const emojiNegative = (content.match(/[😢😭😡🤬😤😰😱💔😞😔]/g) || []).length;
    positiveCount += emojiPositive;
    negativeCount += emojiNegative;

    totalIntensity += clamp01(msgIntensity);
  }

  const avgLength = totalLength / userMessages.length;
  const totalSentiment = positiveCount - negativeCount;
  const sentimentMagnitude = positiveCount + negativeCount;

  // 计算 tone [-1, 1]
  const userTone = sentimentMagnitude === 0
    ? 0
    : clamp(totalSentiment / sentimentMagnitude, -1, 1);

  // 计算 intensity [0, 1]
  const emotionalIntensity = clamp01(
    (totalIntensity / userMessages.length) +
    (sentimentMagnitude > 0 ? 0.2 : 0) +
    (avgLength > 200 ? 0.1 : 0)
  );

  // 支配度：短消息/命令式 → 用户主导；长消息/深度话题 → 用户在倾诉
  const dominanceShift = clamp(
    (avgLength < 30 ? 0.2 : avgLength > 150 ? -0.2 : 0) +
    (userMessages.length > 3 ? -0.1 : 0.1),
    -1, 1,
  );

  // 话题情感
  const topicSentiment = totalSentiment > 1 ? 'positive' as const
    : totalSentiment < -1 ? 'negative' as const
    : sentimentMagnitude > 2 ? 'mixed' as const
    : 'neutral' as const;

  // 互动质量
  const interactionQuality = negativeCount > positiveCount * 2 ? 'conflictual' as const
    : negativeCount > positiveCount ? 'tense' as const
    : positiveCount > 0 ? 'supportive' as const
    : 'neutral' as const;

  // 事件检测
  if (positiveCount > 3) events.push('用户表达了较多正面情绪');
  if (negativeCount > 3) events.push('用户表达了较多负面情绪');
  if (avgLength > 300) events.push('用户发送了长消息（可能在倾诉或深度讨论）');

  // 建议的 State 变化量
  const suggestedStateDelta: PadState = {
    pleasure: clamp(userTone * 0.3, -0.5, 0.5),
    arousal: clamp((emotionalIntensity - 0.3) * 0.4, -0.5, 0.5),
    dominance: clamp(dominanceShift * 0.2, -0.3, 0.3),
  };

  return {
    userTone,
    emotionalIntensity,
    dominanceShift,
    topicSentiment,
    interactionQuality,
    notableEvents: events,
    suggestedStateDelta,
  };
}

function neutralAnalysis(): SentimentAnalysis {
  return {
    userTone: 0,
    emotionalIntensity: 0,
    dominanceShift: 0,
    topicSentiment: 'neutral',
    interactionQuality: 'neutral',
    notableEvents: [],
    suggestedStateDelta: { pleasure: 0, arousal: 0, dominance: 0 },
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
