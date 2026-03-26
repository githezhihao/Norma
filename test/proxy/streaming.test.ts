import { describe, it, expect } from 'vitest';
import { parseSSEStream } from '../../src/proxy/streaming.js';

// 辅助：从字符串构造 mock Response
function mockSSEResponse(sseText: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseText));
      controller.close();
    },
  });
  return new Response(stream);
}

describe('parseSSEStream', () => {
  it('解析标准 SSE chunk', async () => {
    const chunk = {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'gpt-4o-mini',
      choices: [{ index: 0, delta: { content: '你好' }, finish_reason: null }],
    };
    const sse = `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`;
    const res = mockSSEResponse(sse);

    const chunks: unknown[] = [];
    for await (const c of parseSSEStream(res)) {
      if (c !== null) chunks.push(c);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(chunk);
  });

  it('[DONE] 标记终止', async () => {
    const sse = `data: {"id":"1","choices":[{"delta":{"content":"a"},"index":0,"finish_reason":null}]}\n\ndata: [DONE]\n\ndata: {"id":"2","choices":[{"delta":{"content":"should not appear"},"index":0,"finish_reason":null}]}\n\n`;
    const res = mockSSEResponse(sse);

    const chunks: unknown[] = [];
    for await (const c of parseSSEStream(res)) {
      if (c !== null) chunks.push(c);
    }

    expect(chunks).toHaveLength(1);
  });

  it('跳过注释行和空行', async () => {
    const chunk = { id: '1', choices: [{ delta: { content: 'ok' }, index: 0, finish_reason: null }] };
    const sse = `: this is a comment\n\ndata: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`;
    const res = mockSSEResponse(sse);

    const chunks: unknown[] = [];
    for await (const c of parseSSEStream(res)) {
      if (c !== null) chunks.push(c);
    }

    expect(chunks).toHaveLength(1);
  });

  it('跳过无法解析的 JSON', async () => {
    const sse = `data: {invalid json}\n\ndata: {"id":"1","choices":[{"delta":{"content":"ok"},"index":0,"finish_reason":null}]}\n\ndata: [DONE]\n\n`;
    const res = mockSSEResponse(sse);

    const chunks: unknown[] = [];
    for await (const c of parseSSEStream(res)) {
      if (c !== null) chunks.push(c);
    }

    expect(chunks).toHaveLength(1);
  });

  it('处理多个 chunk 拼接', async () => {
    const c1 = { id: '1', choices: [{ delta: { content: '你' }, index: 0, finish_reason: null }] };
    const c2 = { id: '1', choices: [{ delta: { content: '好' }, index: 0, finish_reason: null }] };
    const sse = `data: ${JSON.stringify(c1)}\n\ndata: ${JSON.stringify(c2)}\n\ndata: [DONE]\n\n`;
    const res = mockSSEResponse(sse);

    const chunks: unknown[] = [];
    for await (const c of parseSSEStream(res)) {
      if (c !== null) chunks.push(c);
    }

    expect(chunks).toHaveLength(2);
  });

  it('空 body 不产出 chunk', async () => {
    const res = mockSSEResponse('');

    const chunks: unknown[] = [];
    for await (const c of parseSSEStream(res)) {
      chunks.push(c);
    }

    expect(chunks).toHaveLength(0);
  });
});
