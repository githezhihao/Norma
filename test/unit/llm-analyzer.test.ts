import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { analyzeByLlm } from '@/persona/llm-analyzer.js';
import type { LlmConfig } from '@/types.js';

// Mock global fetch
const originalFetch = global.fetch;

function mockFetch(response: any, ok = true) {
  global.fetch = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => response,
    text: async () => JSON.stringify(response),
  })) as any;
}

function restoreFetch() {
  global.fetch = originalFetch;
}

describe('analyzeByLlm - LLM 情感分析器', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    restoreFetch();
  });

  // ============================================================
  // Anthropic API 调用测试
  // ============================================================

  it('callAnthropic - 正确调用 Anthropic API', async () => {
    const mockResponse = {
      content: [{ type: 'text', text: '{"user_tone":0.8,"emotional_intensity":0.6,"dominance_shift":0.1,"topic_sentiment":"positive","interaction_quality":"supportive","notable_events":["用户表达了感谢"],"suggested_state_delta":{"P":0.25,"A":0.1,"D":0.02}}' }],
    };
    mockFetch(mockResponse);

    const config: LlmConfig = {
      provider: 'anthropic',
      apiKey: 'test-key',
      model: 'claude-sonnet-4-6',
    };

    const messages = [{ role: 'user', content: '太棒了！你帮了大忙！' }];
    const result = await analyzeByLlm(messages, config);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-api-key': 'test-key',
          'anthropic-version': '2023-06-01',
        }),
      }),
    );

    // 验证返回结果解析正确
    expect(result.userTone).toBe(0.8);
    expect(result.emotionalIntensity).toBe(0.6);
    expect(result.topicSentiment).toBe('positive');
  });

  it('callAnthropic - API 错误时降级到 rules', async () => {
    mockFetch({}, false); // ok = false

    const config: LlmConfig = {
      provider: 'anthropic',
      apiKey: 'test-key',
    };

    const messages = [{ role: 'user', content: '测试消息' }];
    const result = await analyzeByLlm(messages, config);

    // 降级后应该有默认值
    expect(result).toBeDefined();
    expect(result.userTone).toBe(0); // 默认中性
  });

  // ============================================================
  // OpenAI API 调用测试
  // ============================================================

  it('callOpenAI - 正确调用 OpenAI API', async () => {
    const mockResponse = {
      choices: [{
        message: {
          content: '{"user_tone":0.5,"emotional_intensity":0.4,"dominance_shift":0.0,"topic_sentiment":"positive","interaction_quality":"supportive","notable_events":[],"suggested_state_delta":{"P":0.1,"A":0.05,"D":0.0}}',
        },
      }],
    };
    mockFetch(mockResponse);

    const config: LlmConfig = {
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
    };

    const messages = [{ role: 'user', content: '这个方案不错~' }];
    const result = await analyzeByLlm(messages, config);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/chat/completions'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-key',
        }),
      }),
    );

    expect(result.topicSentiment).toBe('positive');
  });

  it('callOpenAI - 自定义 baseUrl', async () => {
    const mockResponse = {
      choices: [{ message: { content: '{}' } }],
    };
    mockFetch(mockResponse);

    const config: LlmConfig = {
      provider: 'openai',
      apiKey: 'test-key',
      baseUrl: 'https://custom-api.example.com/v1',
    };

    await analyzeByLlm([{ role: 'user', content: '测试' }], config);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://custom-api.example.com/v1/chat/completions',
      expect.anything(),
    );
  });

  // ============================================================
  // Ollama API 调用测试
  // ============================================================

  it('callOllama - 正确调用 Ollama API', async () => {
    const mockResponse = { response: '{"user_tone":-0.3,"emotional_intensity":0.5,"dominance_shift":-0.1,"topic_sentiment":"negative","interaction_quality":"tense","notable_events":["用户提出质疑"],"suggested_state_delta":{"P":-0.15,"A":0.1,"D":-0.05}}' };
    mockFetch(mockResponse);

    const config: LlmConfig = {
      provider: 'ollama',
      model: 'llama3',
      baseUrl: 'http://localhost:11434',
    };

    const messages = [{ role: 'user', content: '这个功能好像有问题...' }];
    const result = await analyzeByLlm(messages, config);

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/generate',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"model":"llama3"'),
      }),
    );

    expect(result.topicSentiment).toBe('negative');
  });

  it('callOllama - 默认 localhost', async () => {
    const mockResponse = { response: '{}' };
    mockFetch(mockResponse);

    const config: LlmConfig = {
      provider: 'ollama',
      model: 'llama3',
    };

    await analyzeByLlm([{ role: 'user', content: '测试' }], config);

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/generate',
      expect.anything(),
    );
  });

  // ============================================================
  // JSON 解析容错测试
  // ============================================================

  it('parseLlmResponse - 处理 markdown code block 包裹的 JSON', async () => {
    const mockResponse = {
      choices: [{
        message: {
          content: '```json\n{"user_tone":0.5,"emotional_intensity":0.3,"dominance_shift":0.0,"topic_sentiment":"positive","interaction_quality":"supportive","notable_events":[],"suggested_state_delta":{"P":0.1,"A":0.05,"D":0.0}}\n```',
        },
      }],
    };
    mockFetch(mockResponse);

    const config: LlmConfig = { provider: 'openai', apiKey: 'test' };
    const result = await analyzeByLlm([{ role: 'user', content: '测试' }], config);

    expect(result.userTone).toBe(0.5);
  });

  it('parseLlmResponse - 处理前后有文字的 JSON', async () => {
    const mockResponse = {
      choices: [{
        message: {
          content: '好的，我来分析一下：\n\n{"user_tone":0.3,"emotional_intensity":0.2,"dominance_shift":0.0,"topic_sentiment":"neutral","interaction_quality":"neutral","notable_events":[],"suggested_state_delta":{"P":0.05,"A":0.02,"D":0.0}}\n\n希望这对你有帮助！',
        },
      }],
    };
    mockFetch(mockResponse);

    const config: LlmConfig = { provider: 'openai', apiKey: 'test' };
    const result = await analyzeByLlm([{ role: 'user', content: '测试' }], config);

    expect(result.userTone).toBe(0.3);
    expect(result.topicSentiment).toBe('neutral');
  });

  it('parseLlmResponse - 处理无效 JSON 时降级到 rules', async () => {
    const mockResponse = {
      choices: [{ message: { content: '这是一个无效的 JSON 响应，没有大括号' } }],
    };
    mockFetch(mockResponse);

    const config: LlmConfig = { provider: 'openai', apiKey: 'test' };
    const result = await analyzeByLlm([{ role: 'user', content: '测试' }], config);

    // 降级后应该有合理的默认值
    expect(result).toBeDefined();
    expect(result.userTone).toBe(0);
  });

  it('parseLlmResponse - 缺失字段使用默认值', async () => {
    const mockResponse = {
      choices: [{ message: { content: '{"user_tone":0.5}' } }], // 只提供一个字段
    };
    mockFetch(mockResponse);

    const config: LlmConfig = { provider: 'openai', apiKey: 'test' };
    const result = await analyzeByLlm([{ role: 'user', content: '测试' }], config);

    // 缺失字段应该有默认值
    expect(result.userTone).toBe(0.5);
    expect(result.emotionalIntensity).toBe(0); // 默认
    expect(result.topicSentiment).toBe('neutral'); // 默认
    expect(result.interactionQuality).toBe('neutral'); // 默认
    expect(result.notableEvents).toEqual([]); // 默认
  });

  // ============================================================
  // 边界值处理测试
  // ============================================================

  it('parseLlmResponse - 超出范围的字段自动 clamp', async () => {
    const mockResponse = {
      choices: [{
        message: {
          content: '{"user_tone":1.5,"emotional_intensity":-0.5,"dominance_shift":2.0,"topic_sentiment":"positive","interaction_quality":"supportive","notable_events":[],"suggested_state_delta":{"P":0.8,"A":-0.6,"D":0.5}}',
        },
      }],
    };
    mockFetch(mockResponse);

    const config: LlmConfig = { provider: 'openai', apiKey: 'test' };
    const result = await analyzeByLlm([{ role: 'user', content: '测试' }], config);

    // 验证字段被 clamp 到有效范围
    expect(result.userTone).toBeLessThanOrEqual(1);
    expect(result.userTone).toBeGreaterThanOrEqual(-1);
    expect(result.emotionalIntensity).toBeGreaterThanOrEqual(0);
    expect(result.emotionalIntensity).toBeLessThanOrEqual(1);
    expect(result.dominanceShift).toBeLessThanOrEqual(1);
    expect(result.dominanceShift).toBeGreaterThanOrEqual(-1);
  });

  it('parseLlmResponse - 无效的枚举值使用 fallback', async () => {
    const mockResponse = {
      choices: [{
        message: {
          content: '{"user_tone":0,"emotional_intensity":0,"dominance_shift":0,"topic_sentiment":"invalid_enum","interaction_quality":"unknown_quality","notable_events":[],"suggested_state_delta":{"P":0,"A":0,"D":0}}',
        },
      }],
    };
    mockFetch(mockResponse);

    const config: LlmConfig = { provider: 'openai', apiKey: 'test' };
    const result = await analyzeByLlm([{ role: 'user', content: '测试' }], config);

    expect(result.topicSentiment).toBe('neutral'); // fallback
    expect(result.interactionQuality).toBe('neutral'); // fallback
  });

  // ============================================================
  // 降级逻辑测试
  // ============================================================

  it('LLM 超时自动降级到 rules', async () => {
    // Mock 一个超时的 fetch
    global.fetch = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      throw new Error('Timeout');
    }) as any;

    const config: LlmConfig = { provider: 'anthropic', apiKey: 'test' };
    const messages = [{ role: 'user', content: '这个消息会触发降级' }];

    // 不应该抛出异常，而是返回 rules 分析结果
    await expect(analyzeByLlm(messages, config)).resolves.toBeDefined();
  });

  it('未知 provider 抛出错误并降级', async () => {
    const config: LlmConfig = { provider: 'unknown' as any, apiKey: 'test' };
    const messages = [{ role: 'user', content: '测试' }];

    // 未知 provider 会抛出错误，然后被 catch 降级
    const result = await analyzeByLlm(messages, config);

    // 降级后返回 rules 分析结果
    expect(result).toBeDefined();
    expect(result.userTone).toBe(0);
  });

  // ============================================================
  // 多消息分析测试
  // ============================================================

  it('分析多消息对话', async () => {
    const mockResponse = {
      content: [{
        type: 'text',
        text: '{"user_tone":0.6,"emotional_intensity":0.7,"dominance_shift":0.2,"topic_sentiment":"positive","interaction_quality":"supportive","notable_events":["多轮友好对话"],"suggested_state_delta":{"P":0.2,"A":0.15,"D":0.03}}',
      }],
    };
    mockFetch(mockResponse);

    const config: LlmConfig = { provider: 'anthropic', apiKey: 'test' };
    const messages = [
      { role: 'user', content: '你好啊~' },
      { role: 'assistant', content: '老大好！有什么可以帮你的吗？' },
      { role: 'user', content: '帮我查一下今天的天气' },
    ];

    const result = await analyzeByLlm(messages, config);

    expect(global.fetch).toHaveBeenCalled();
    // 验证调用时包含了所有消息
    const callArgs = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.messages[0].content).toContain('你好啊~');
    expect(body.messages[0].content).toContain('帮我查一下今天的天气');
  });
});
