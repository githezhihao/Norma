// ============================================================
// LLM 驱动情感分析器
// 支持 Anthropic / OpenAI / Ollama，无额外 SDK 依赖
// 分析失败时自动降级到规则分析
// ============================================================

import type { SentimentAnalysis, PadState, LlmConfig } from '../types.js';
import { analyzeByRules } from './analyzer.js';

const ANALYSIS_PROMPT = `你是一个情感分析专家。分析以下对话片段中用户的情感状态和互动模式。

只输出 JSON，不要任何其他文字：
{
  "user_tone": <-1到1的数字, 负面到正面>,
  "emotional_intensity": <0到1的数字, 平淡到强烈>,
  "dominance_shift": <-1到1的数字, 用户被动到用户主导>,
  "topic_sentiment": "positive|neutral|negative|mixed",
  "interaction_quality": "supportive|neutral|tense|conflictual",
  "notable_events": ["事件描述1", "事件描述2"],
  "suggested_state_delta": { "P": <-0.5到0.5>, "A": <-0.5到0.5>, "D": <-0.3到0.3> }
}

对话片段：
`;

/**
 * 用 LLM 分析情感，失败时降级到规则分析
 */
export async function analyzeByLlm(
  messages: Array<{ role: string; content: string }>,
  config: LlmConfig,
): Promise<SentimentAnalysis> {
  try {
    const conversationText = messages
      .map(m => `[${m.role}]: ${m.content}`)
      .join('\n');

    const prompt = ANALYSIS_PROMPT + conversationText;
    const raw = await callLlm(prompt, config);
    return parseLlmResponse(raw);
  } catch {
    // 降级到规则分析
    return analyzeByRules(messages);
  }
}

async function callLlm(prompt: string, config: LlmConfig): Promise<string> {
  switch (config.provider) {
    case 'anthropic':
      return callAnthropic(prompt, config);
    case 'openai':
      return callOpenAI(prompt, config);
    case 'ollama':
      return callOllama(prompt, config);
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

async function callAnthropic(prompt: string, config: LlmConfig): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model || 'claude-sonnet-4-20250514',
      max_tokens: 512,
      temperature: config.temperature ?? 0.1,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
  const data = await res.json() as any;
  return data.content?.[0]?.text || '';
}

async function callOpenAI(prompt: string, config: LlmConfig): Promise<string> {
  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || 'gpt-4o-mini',
      temperature: config.temperature ?? 0.1,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`);
  const data = await res.json() as any;
  return data.choices?.[0]?.message?.content || '';
}

async function callOllama(prompt: string, config: LlmConfig): Promise<string> {
  const baseUrl = config.baseUrl || 'http://localhost:11434';
  const res = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model || 'llama3',
      prompt,
      stream: false,
      options: { temperature: config.temperature ?? 0.1 },
    }),
  });
  if (!res.ok) throw new Error(`Ollama API error: ${res.status}`);
  const data = await res.json() as any;
  return data.response || '';
}

function parseLlmResponse(raw: string): SentimentAnalysis {
  // 提取 JSON（LLM 可能在 JSON 前后加文字）
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in LLM response');

  const parsed = JSON.parse(jsonMatch[0]);

  const suggestedStateDelta: PadState = {
    pleasure: clamp(parsed.suggested_state_delta?.P ?? 0, -0.5, 0.5),
    arousal: clamp(parsed.suggested_state_delta?.A ?? 0, -0.5, 0.5),
    dominance: clamp(parsed.suggested_state_delta?.D ?? 0, -0.3, 0.3),
  };

  return {
    userTone: clamp(parsed.user_tone ?? 0, -1, 1),
    emotionalIntensity: clamp(parsed.emotional_intensity ?? 0, 0, 1),
    dominanceShift: clamp(parsed.dominance_shift ?? 0, -1, 1),
    topicSentiment: validateEnum(parsed.topic_sentiment, ['positive', 'neutral', 'negative', 'mixed'], 'neutral'),
    interactionQuality: validateEnum(parsed.interaction_quality, ['supportive', 'neutral', 'tense', 'conflictual'], 'neutral'),
    notableEvents: Array.isArray(parsed.notable_events) ? parsed.notable_events : [],
    suggestedStateDelta,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function validateEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}
