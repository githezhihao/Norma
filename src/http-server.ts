// ============================================================
// HTTP Server — Layer 2 轻量 HTTP 接口
// 给平台 hook 调用（如 OpenClaw），仅监听 localhost
// Node.js 原生 http 模块，不引入 Express
// ============================================================

import { createServer as createHttpServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { appendFileSync, statSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PersonaEngine } from './core/persona-engine.js';
import { getDashboardHtml } from './dashboard.js';

const DEFAULT_PORT = 19820;
const LOG_PATH = resolve(process.env.PERSONA_LOG ?? `${process.env.HOME ?? '.'}/.norma/persona.log`);
const LOG_JSON = process.env.PERSONA_LOG_FORMAT === 'json';
const LOG_MAX_BYTES = 5 * 1024 * 1024;

function httpLog(method: string, url: string, status: number, ms: number) {
  // 简单轮转
  try {
    const st = statSync(LOG_PATH);
    if (st.size > LOG_MAX_BYTES) renameSync(LOG_PATH, LOG_PATH + '.1');
  } catch { /* ignore */ }

  const ts = new Date().toISOString().replace('T', ' ').slice(0, 23);
  let line: string;
  if (LOG_JSON) {
    line = JSON.stringify({ ts, level: 'INFO', tag: 'http', msg: `${method} ${url} → ${status} (${ms}ms)` }) + '\n';
  } else {
    line = `${ts} [INFO] [http] ${method} ${url} → ${status} (${ms}ms)\n`;
  }
  try { appendFileSync(LOG_PATH, line); } catch { /* ignore */ }
}

export function createHttpApi(engine: PersonaEngine, port: number = DEFAULT_PORT): Server {
  const server = createHttpServer(async (req, res) => {
    // CORS for local dev
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const start = Date.now();
      const url = new URL(req.url || '/', `http://localhost:${port}`);
      const path = url.pathname;

      if (path === '/api/record' && req.method === 'POST') {
        await handleRecord(engine, req, res);
      } else if (path === '/api/state' && req.method === 'GET') {
        handleState(engine, url, res);
      } else if (path === '/api/evolve' && req.method === 'POST') {
        await handleEvolve(engine, req, res);
      } else if (path === '/api/health' && req.method === 'GET') {
        handleHealth(engine, res);
      } else if (path === '/api/dashboard' && req.method === 'GET') {
        handleDashboard(engine, res);
      } else if (path === '/api/init' && req.method === 'POST') {
        await handleInit(engine, req, res);
      } else if (path === '/api/recall' && req.method === 'GET') {
        handleRecall(engine, url, res);
      } else if (path === '/api/history' && req.method === 'GET') {
        handleHistory(engine, url, res);
      } else if (path === '/api/relationship' && req.method === 'GET') {
        handleRelationship(engine, res);
      } else if (path === '/api/config' && req.method === 'GET') {
        handleConfigGet(engine, res);
      } else if (path === '/api/config' && req.method === 'POST') {
        await handleConfigSet(engine, req, res);
      } else if (path === '/dashboard' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getDashboardHtml());
      } else {
        json(res, 404, { error: 'Not found' });
      }
      httpLog(req.method || 'GET', path, res.statusCode, Date.now() - start);
    } catch (err: any) {
      const ts = new Date().toISOString().replace('T', ' ').slice(0, 23);
      const errMsg = err?.message || 'Internal error';
      const line = LOG_JSON
        ? JSON.stringify({ ts, level: 'ERR', tag: 'http', msg: `${req.method} ${req.url} error: ${errMsg}` }) + '\n'
        : `${ts} [ERR] [http] ${req.method} ${req.url} error: ${errMsg}\n`;
      try { appendFileSync(LOG_PATH, line); } catch { /* ignore */ }
      process.stderr.write(line);
      json(res, 500, { error: errMsg });
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(`[norma] HTTP port ${port} already in use, skipping HTTP API\n`);
      server.close();
    } else {
      process.stderr.write(`[norma] HTTP server error: ${err.message}\n`);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    process.stderr.write(`[norma] HTTP API listening on http://127.0.0.1:${port}\n`);
  });

  return server;
}

// ---- Handlers ----

function handleHealth(engine: PersonaEngine, res: ServerResponse): void {
  const metrics = engine.getMetrics();
  json(res, 200, {
    status: 'ok',
    uptime: metrics.uptimeMs,
    startedAt: new Date(metrics.startedAt).toISOString(),
    db: { sizeBytes: metrics.dbSizeBytes, messages: metrics.messageCount },
    vec: metrics.vecEnabled,
    llm: metrics.llmProvider,
    errors: { count: metrics.errorCount, last: metrics.lastError },
    lastEvolveAt: metrics.lastEvolveAt ? new Date(metrics.lastEvolveAt).toISOString() : null,
  });
}

function handleDashboard(engine: PersonaEngine, res: ServerResponse): void {
  const metrics = engine.getMetrics();
  const analytics = engine.getEvolutionAnalytics();
  const traits = engine.getTraits();
  const state = engine.getState();
  const relationship = engine.getRelationship();
  // 最近 50 条 state 历史用于趋势折线图
  const history = engine.getHistory('state', 50);

  json(res, 200, {
    health: {
      status: 'ok',
      uptimeMs: metrics.uptimeMs,
      errors: metrics.errorCount,
    },
    persona: {
      name: traits?.personalityName ?? null,
      ocean: traits ? {
        O: traits.openness, C: traits.conscientiousness,
        E: traits.extraversion, A: traits.agreeableness, N: traits.neuroticism,
      } : null,
      pad: state ? { P: state.pleasure, A: state.arousal, D: state.dominance } : null,
      relationship: {
        trust: relationship.trustLevel,
        tone: relationship.avgTone,
        style: relationship.interactionStyle,
        interactions: relationship.totalInteractions,
      },
    },
    evolution: {
      total: analytics.total,
      recentTrend: analytics.recentTrend,
      volatility: analytics.volatility,
      triggerBreakdown: analytics.triggerBreakdown,
    },
    history: history.map(h => ({
      timestamp: h.timestamp,
      trigger: h.triggerType,
      values: h.values,
      summary: h.triggerSummary,
    })),
    system: {
      dbSizeBytes: metrics.dbSizeBytes,
      messageCount: metrics.messageCount,
      vecEnabled: metrics.vecEnabled,
      llmProvider: metrics.llmProvider,
    },
  });
}

async function handleRecord(engine: PersonaEngine, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  const { role, content, platform, sessionId } = body;

  if (!role || !content) {
    json(res, 400, { error: 'Missing required fields: role, content' });
    return;
  }

  const { message, evolveResult } = await engine.recordAndMaybeEvolve({
    role,
    content,
    platform: platform ?? 'http',
    sessionId: sessionId ?? null,
  });

  json(res, 200, {
    id: message.id,
    evolved: !!evolveResult,
    state: evolveResult ? {
      pleasure: evolveResult.newState.pleasure,
      arousal: evolveResult.newState.arousal,
      dominance: evolveResult.newState.dominance,
    } : undefined,
  });
}

function handleState(engine: PersonaEngine, url: URL, res: ServerResponse): void {
  const format = (url.searchParams.get('format') ?? 'json') as 'prompt' | 'json';
  const text = engine.narrateState(format);

  if (format === 'prompt') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(text);
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(text);
  }
}

async function handleEvolve(engine: PersonaEngine, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  const messageCount = body.messageCount ?? engine.getConfig().evolveEveryN;
  const messages = engine.getRecentUserMessages(messageCount);

  if (messages.length === 0) {
    json(res, 200, { evolved: false, reason: 'no messages' });
    return;
  }

  const result = await engine.evolve(messages, 'manual');
  json(res, 200, {
    evolved: true,
    method: result.analysisMethod,
    state: {
      pleasure: result.newState.pleasure,
      arousal: result.newState.arousal,
      dominance: result.newState.dominance,
    },
    traitChanged: result.traitChanged,
  });
}

// ---- Init ----

async function handleInit(engine: PersonaEngine, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  const ocean: any = {};
  if (body.openness != null) ocean.openness = body.openness;
  if (body.conscientiousness != null) ocean.conscientiousness = body.conscientiousness;
  if (body.extraversion != null) ocean.extraversion = body.extraversion;
  if (body.agreeableness != null) ocean.agreeableness = body.agreeableness;
  if (body.neuroticism != null) ocean.neuroticism = body.neuroticism;

  engine.initPersona(body.name, body.description, Object.keys(ocean).length > 0 ? ocean : undefined);
  const traits = engine.getTraits();
  json(res, 200, {
    name: traits?.personalityName,
    ocean: traits ? { O: traits.openness, C: traits.conscientiousness, E: traits.extraversion, A: traits.agreeableness, N: traits.neuroticism } : null,
    version: traits?.version,
  });
}

// ---- Recall ----

function handleRecall(engine: PersonaEngine, url: URL, res: ServerResponse): void {
  const query = url.searchParams.get('query') || '';
  const limit = parseInt(url.searchParams.get('limit') || '10');
  if (!query) { json(res, 400, { error: 'query parameter required' }); return; }
  const results = engine.recall(query, limit);
  json(res, 200, { results });
}

// ---- History ----

function handleHistory(engine: PersonaEngine, url: URL, res: ServerResponse): void {
  const layer = (url.searchParams.get('layer') || 'all') as 'trait' | 'state' | 'all';
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const summary = url.searchParams.get('summary') === 'true';
  const history = engine.getHistory(layer, limit);

  const result: any = { history };
  if (summary) {
    result.analytics = engine.getEvolutionAnalytics();
  }
  json(res, 200, result);
}

// ---- Relationship ----

function handleRelationship(engine: PersonaEngine, res: ServerResponse): void {
  json(res, 200, engine.getRelationship());
}

// ---- Config ----

function handleConfigGet(engine: PersonaEngine, res: ServerResponse): void {
  json(res, 200, {
    evolution: engine.getConfig(),
    llm: engine.getLlmConfig(),
  });
}

async function handleConfigSet(engine: PersonaEngine, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  if (body.evolution) engine.updateConfig(body.evolution);
  if (body.llm) engine.setLlmConfig(body.llm);
  json(res, 200, {
    evolution: engine.getConfig(),
    llm: engine.getLlmConfig(),
  });
}

// ---- Utilities ----

function readBody(req: IncomingMessage): Promise<any> {
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

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
