import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer as createHttpServer, type Server } from 'node:http';
import { PersonaEngine } from '../../src/core/persona-engine.js';
import { createProxyServer } from '../../src/proxy/server.js';
import type { ProxyConfig } from '../../src/proxy/config.js';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

let engine: PersonaEngine;
let testDir: string;
let proxyServer: Server;
let mockLlmServer: Server;

const PROXY_PORT = 19899;
const MOCK_LLM_PORT = 19898;
const PROXY_URL = `http://127.0.0.1:${PROXY_PORT}`;

// Mock LLM 服务器：模拟 OpenAI API
function createMockLlmServer(): Promise<Server> {
  return new Promise((resolve) => {
    const server = createHttpServer((req, res) => {
      if (req.url === '/chat/completions' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const body = JSON.parse(Buffer.concat(chunks).toString());

          if (body.stream) {
            // 流式响应
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
            });
            const chunk1 = {
              id: 'chatcmpl-test',
              object: 'chat.completion.chunk',
              created: Date.now(),
              model: body.model || 'mock-model',
              choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
            };
            const chunk2 = {
              id: 'chatcmpl-test',
              object: 'chat.completion.chunk',
              created: Date.now(),
              model: body.model || 'mock-model',
              choices: [{ index: 0, delta: { content: 'Mock回复' }, finish_reason: null }],
            };
            const chunk3 = {
              id: 'chatcmpl-test',
              object: 'chat.completion.chunk',
              created: Date.now(),
              model: body.model || 'mock-model',
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            };

            res.write(`data: ${JSON.stringify(chunk1)}\n\n`);
            res.write(`data: ${JSON.stringify(chunk2)}\n\n`);
            res.write(`data: ${JSON.stringify(chunk3)}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
          } else {
            // 非流式响应
            // 验证注入：检查 system message 是否包含 Norma 标记
            const sysMsg = body.messages?.find((m: any) => m.role === 'system');
            const hasInjection = sysMsg?.content?.includes('[Norma 人格状态]') ?? false;

            const response = {
              id: 'chatcmpl-test',
              object: 'chat.completion',
              created: Date.now(),
              model: body.model || 'mock-model',
              choices: [{
                index: 0,
                message: {
                  role: 'assistant',
                  content: hasInjection ? 'Mock回复(已注入)' : 'Mock回复(无注入)',
                },
                finish_reason: 'stop',
              }],
              usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(response));
          }
        });
      } else if (req.url === '/models' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'mock-model', object: 'model' }] }));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    server.listen(MOCK_LLM_PORT, '127.0.0.1', () => resolve(server));
  });
}

beforeEach(async () => {
  testDir = join(tmpdir(), `proxy-e2e-test-${randomUUID()}`);
  mkdirSync(testDir, { recursive: true });
  engine = new PersonaEngine(join(testDir, 'test.sqlite'));
  engine.initPersona('TestBot', '测试机器人');

  mockLlmServer = await createMockLlmServer();

  const config: ProxyConfig = {
    proxyPort: PROXY_PORT,
    targetBaseUrl: `http://127.0.0.1:${MOCK_LLM_PORT}`,
    targetApiKey: 'test-key',
    dbPath: join(testDir, 'test.sqlite'),
    injectionEnabled: true,
    memoryRecallEnabled: false, // 测试中关闭记忆召回简化
    memoryThreshold: 0.3,
    memoryMaxTokens: 800,
    anchorInterval: 20,
  };

  proxyServer = createProxyServer(engine, config);
  await new Promise<void>(resolve => proxyServer.on('listening', resolve));
});

afterEach(async () => {
  await new Promise<void>(resolve => proxyServer.close(() => resolve()));
  await new Promise<void>(resolve => mockLlmServer.close(() => resolve()));
  engine.close();
  rmSync(testDir, { recursive: true, force: true });
});

describe('E2E Proxy', () => {
  it('GET /health 返回代理状态', async () => {
    const res = await fetch(`${PROXY_URL}/health`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.status).toBe('ok');
    expect(data.proxy.injection).toBe(true);
    expect(data.persona.name).toBe('TestBot');
  });

  it('POST /v1/chat/completions 非流式转发 + 注入', async () => {
    const res = await fetch(`${PROXY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mock-model',
        messages: [{ role: 'user', content: '你好' }],
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.choices[0].message.content).toBe('Mock回复(已注入)');
  });

  it('POST /v1/chat/completions 流式转发', async () => {
    const res = await fetch(`${PROXY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mock-model',
        messages: [{ role: 'user', content: '你好' }],
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');

    const text = await res.text();
    expect(text).toContain('data: ');
    expect(text).toContain('[DONE]');
    expect(text).toContain('Mock回复');
  });

  it('GET /v1/models 透传', async () => {
    const res = await fetch(`${PROXY_URL}/v1/models`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.data[0].id).toBe('mock-model');
  });

  it('未知路径返回 404', async () => {
    const res = await fetch(`${PROXY_URL}/unknown`);
    expect(res.status).toBe(404);
  });

  it('CORS headers 正确', async () => {
    const res = await fetch(`${PROXY_URL}/health`);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('X-Norma-Session header 传递 sessionId', async () => {
    const res = await fetch(`${PROXY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Norma-Session': 'test-session-42',
      },
      body: JSON.stringify({
        model: 'mock-model',
        messages: [{ role: 'user', content: '测试会话' }],
      }),
    });

    expect(res.status).toBe(200);
  });

  it('消息被异步记录', async () => {
    await fetch(`${PROXY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mock-model',
        messages: [{ role: 'user', content: '记录测试' }],
      }),
    });

    // 等待异步记录完成
    await new Promise(r => setTimeout(r, 200));

    const messages = engine.getRecentMessages(10);
    const userMsg = messages.find(m => m.role === 'user' && m.content === '记录测试');
    expect(userMsg).toBeDefined();
    expect(userMsg!.platform).toBe('norma-proxy');
  });
});
