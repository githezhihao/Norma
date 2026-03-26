/**
 * Norma Proxy HTTP 服务器
 * OpenAI 兼容的透明 API 代理
 */

import {
  createServer as createHttpServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { appendFileSync, statSync, renameSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { PersonaEngine } from '../core/persona-engine.js';
import type { ProxyConfig } from './config.js';
import type { ChatCompletionRequest } from './types.js';
import { AsyncRecorder } from './recorder.js';
import { handleChatCompletion } from './interceptor.js';

// ---- 文件日志 ----
const LOG_DIR = resolve(process.env.HOME ?? '.', '.norma', 'logs');
const LOG_PATH = resolve(LOG_DIR, 'proxy.log');
const LOG_MAX_BYTES = 10 * 1024 * 1024; // 10MB 轮转
const LOG_KEEP = 3; // 保留 3 个历史日志

function ensureLogDir() {
  try { mkdirSync(LOG_DIR, { recursive: true }); } catch { /* ignore */ }
}

function rotateIfNeeded() {
  try {
    const st = statSync(LOG_PATH);
    if (st.size > LOG_MAX_BYTES) {
      // proxy.log.3 → 删除, .2 → .3, .1 → .2, .log → .1
      for (let i = LOG_KEEP; i >= 1; i--) {
        try {
          const src = i === 1 ? LOG_PATH : `${LOG_PATH}.${i - 1}`;
          const dst = `${LOG_PATH}.${i}`;
          renameSync(src, dst);
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

function proxyLog(level: 'INFO' | 'WARN' | 'ERROR', method: string, path: string, status: number, ms: number, detail?: string) {
  const ts = new Date().toISOString();
  const extra = detail ? ` | ${detail}` : '';
  const line = `${ts} [${level}] ${method} ${path} → ${status} (${ms}ms)${extra}\n`;
  // stderr (终端 + launchd 日志)
  process.stderr.write(`[norma-proxy] ${line}`);
  // 文件日志
  try {
    rotateIfNeeded();
    appendFileSync(LOG_PATH, line);
  } catch { /* ignore */ }
}

export function createProxyServer(
  engine: PersonaEngine,
  config: ProxyConfig,
): Server {
  ensureLogDir();
  const recorder = new AsyncRecorder(engine);

  const server = createHttpServer(async (req, res) => {
    // CORS — 代理面向外部客户端，允许所有来源
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Norma-Session');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const start = Date.now();
    const url = new URL(req.url || '/', `http://localhost:${config.proxyPort}`);
    const path = url.pathname;

    try {
      if (path === '/v1/chat/completions' && req.method === 'POST') {
        const body = await readBody(req);
        await handleChatCompletion(req, body as ChatCompletionRequest, res, engine, recorder, config);
      } else if (path === '/v1/models' && req.method === 'GET') {
        await handleModelsProxy(config, req, res);
      } else if (path === '/health' && req.method === 'GET') {
        handleHealth(engine, config, res);
      } else {
        jsonResponse(res, 404, { error: { message: 'Not found', type: 'not_found' } });
      }

      const ms = Date.now() - start;
      proxyLog('INFO', req.method || 'GET', path, res.statusCode, ms);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const ms = Date.now() - start;
      proxyLog('ERROR', req.method || 'GET', path, 500, ms, errMsg);
      if (!res.headersSent) {
        jsonResponse(res, 500, { error: { message: 'Internal proxy error', detail: errMsg } });
      }
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(`[norma-proxy] 端口 ${config.proxyPort} 已被占用\n`);
      server.close();
    } else {
      process.stderr.write(`[norma-proxy] 服务器错误: ${err.message}\n`);
    }
  });

  server.listen(config.proxyPort, '0.0.0.0', () => {
    const startMsg = `代理已启动 http://0.0.0.0:${config.proxyPort} | 上游: ${config.targetBaseUrl} | 注入: ${config.injectionEnabled ? '开启' : '关闭'} | 记忆: ${config.memoryRecallEnabled ? '开启' : '关闭'} | 日志: ${LOG_PATH}`;
    process.stderr.write(`[norma-proxy] ${startMsg}\n`);
    try { appendFileSync(LOG_PATH, `${new Date().toISOString()} [INFO] ${startMsg}\n`); } catch { /* ignore */ }
  });

  return server;
}

/** 透传 /v1/models 到上游 */
async function handleModelsProxy(
  config: ProxyConfig,
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const upstream = await fetch(`${config.targetBaseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${config.targetApiKey}` },
    });
    const body = await upstream.text();
    res.writeHead(upstream.status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    jsonResponse(res, 502, { error: { message: 'Failed to fetch models', detail: errMsg } });
  }
}

function handleHealth(engine: PersonaEngine, config: ProxyConfig, res: ServerResponse): void {
  const metrics = engine.getMetrics();
  const traits = engine.getTraits();
  jsonResponse(res, 200, {
    status: 'ok',
    proxy: {
      port: config.proxyPort,
      target: config.targetBaseUrl,
      injection: config.injectionEnabled,
      memory: config.memoryRecallEnabled,
    },
    persona: {
      name: traits?.personalityName ?? null,
      messageCount: metrics.messageCount,
      evolveCount: metrics.evolveCount,
    },
    uptime: metrics.uptimeMs,
  });
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}
