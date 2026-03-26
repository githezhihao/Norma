// ============================================================
// LLM 驱动情感分析器
// 支持 Anthropic / OpenAI / Ollama，无额外 SDK 依赖
// 分析失败时自动降级到规则分析
// ============================================================

import type { SentimentAnalysis, PadState, LlmConfig } from '../types.js';
import { analyzeByRules } from './analyzer.js';

/**
 * 获取默认 LLM 配置
 * 默认使用阿里云 DashScope (兼容 OpenAI 格式)
 */
function getDefaultLlmConfig(): LlmConfig {
  // 环境变量覆盖
  const baseUrl = process.env.NORMA_LLM_BASE_URL;
  const apiKey = process.env.NORMA_LLM_API_KEY;
  const model = process.env.NORMA_LLM_MODEL;
  const provider = process.env.NORMA_LLM_PROVIDER || 'openai';

  if (baseUrl || apiKey) {
    return {
      provider: provider as LlmConfig['provider'],
      baseUrl,
      apiKey: apiKey || 'dummy',
      model,
    };
  }

  // 默认不启用 LLM 分析，需用户配置环境变量
  // 推荐配置：
  // - OpenAI: NORMA_LLM_PROVIDER=openai, NORMA_LLM_API_KEY=sk-xxx
  // - 阿里云 DashScope: NORMA_LLM_PROVIDER=openai, NORMA_LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
  // - Ollama: NORMA_LLM_PROVIDER=ollama
  return { provider: 'none' };
}

const ANALYSIS_PROMPT = `分析用户情感状态。只输出JSON，无其他文字。

示例输入: "[user]: 太棒了！你帮了大忙！"
示例输出: {"user_tone":0.8,"emotional_intensity":0.6,"dominance_shift":0.1,"topic_sentiment":"positive","interaction_quality":"supportive","notable_events":["用户表达了感激"],"suggested_state_delta":{"P":0.25,"A":0.1,"D":0.02}}

示例输入: "[user]: 垃圾！完全不行！"
示例输出: {"user_tone":-0.9,"emotional_intensity":0.8,"dominance_shift":0.3,"topic_sentiment":"negative","interaction_quality":"conflictual","notable_events":["用户强烈不满"],"suggested_state_delta":{"P":-0.4,"A":0.2,"D":0.06}}

字段说明:
- user_tone: [-1,1] 用户语气正负
- emotional_intensity: [0,1] 情绪强度
- dominance_shift: [-1,1] 用户主导度
- topic_sentiment: positive/neutral/negative/mixed
- interaction_quality: supportive/neutral/tense/conflictual
- notable_events: 关键事件列表
- suggested_state_delta: P=愉悦度[-0.5,0.5] A=唤醒度[-0.5,0.5] D=支配度[-0.3,0.3]

对话片段：
`;

/**
 * 用 LLM 分析情感，失败时降级到规则分析
 */
export async function analyzeByLlm(
  messages: Array<{ role: string; content: string }>,
  config?: LlmConfig,  // 改为可选参数
): Promise<SentimentAnalysis> {
  const effectiveConfig = config ?? getDefaultLlmConfig();
  try {
    const conversationText = messages
      .map(m => `[${m.role}]: ${m.content}`)
      .join('\n');

    const prompt = ANALYSIS_PROMPT + conversationText;
    const raw = await callLlm(prompt, effectiveConfig);
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
  // 提取 JSON（兼容 markdown code block 和前后文字）
  let jsonStr = raw;
  // 去除 markdown code block
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }
  // 提取最外层 {}
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
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
