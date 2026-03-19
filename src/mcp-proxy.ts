// ============================================================
// Norma MCP Proxy — 无状态 MCP 代理
// 所有操作通过 HTTP 转发到 Norma Core 服务
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const NORMA_API = `http://127.0.0.1:${process.env.NORMA_HTTP_PORT || '19820'}`;

async function api(path: string, opts?: RequestInit): Promise<any> {
  const res = await fetch(`${NORMA_API}${path}`, {
    ...opts,
    signal: AbortSignal.timeout(5000),
  });
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    const msg = ct.includes('json')
      ? (await res.json()).error
      : await res.text();
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return ct.includes('json') ? res.json() : res.text();
}

function post(path: string, body: any): Promise<any> {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function createProxyServer(): McpServer {
  const server = new McpServer({
    name: 'norma',
    version: '0.2.0',
  });

  // ---- persona_init ----
  server.tool('persona_init', '初始化人格', {
    name: z.string().optional(),
    description: z.string().optional(),
    openness: z.number().min(0).max(1).optional(),
    conscientiousness: z.number().min(0).max(1).optional(),
    extraversion: z.number().min(0).max(1).optional(),
    agreeableness: z.number().min(0).max(1).optional(),
    neuroticism: z.number().min(0).max(1).optional(),
  }, async (params) => {
    const d = await post('/api/init', params);
    return { content: [{ type: 'text' as const, text: `人格已初始化：${d.name}\nOCEAN: O=${d.ocean.O.toFixed(2)} C=${d.ocean.C.toFixed(2)} E=${d.ocean.E.toFixed(2)} A=${d.ocean.A.toFixed(2)} N=${d.ocean.N.toFixed(2)}` }] };
  });

  // ---- persona_record ----
  server.tool('persona_record', '记录对话消息', {
    role: z.enum(['user', 'assistant']),
    content: z.string(),
    platform: z.string().optional(),
    sessionId: z.string().optional(),
  }, async (params) => {
    const d = await post('/api/record', params);
    let text = `已记录 [${params.role}] 消息 (${d.id.slice(0, 8)})`;
    if (d.evolved) text += `\n触发演化: P=${d.state.pleasure.toFixed(3)} A=${d.state.arousal.toFixed(3)} D=${d.state.dominance.toFixed(3)}`;
    return { content: [{ type: 'text' as const, text }] };
  });

  // ---- persona_recall ----
  server.tool('persona_recall', '检索相关历史记忆', {
    query: z.string(),
    limit: z.number().optional(),
  }, async (params) => {
    const d = await api(`/api/recall?query=${encodeURIComponent(params.query)}&limit=${params.limit || 10}`);
    if (!d.results || d.results.length === 0) return { content: [{ type: 'text' as const, text: '未找到相关记录。' }] };
    const lines = d.results.map((r: any, i: number) => `${i + 1}. [${r.role}] (${new Date(r.timestamp).toLocaleString('zh-CN')}, 相关度: ${r.score.toFixed(3)})\n   ${r.content}`);
    return { content: [{ type: 'text' as const, text: `找到 ${d.results.length} 条相关记录：\n\n${lines.join('\n\n')}` }] };
  });

  // ---- persona_state ----
  server.tool('persona_state', '获取当前人格状态', {
    format: z.enum(['prompt', 'json', 'full']).optional(),
  }, async (params) => {
    const fmt = params.format || 'prompt';
    const d = await api(`/api/state?format=${fmt}`);
    const text = typeof d === 'string' ? d : JSON.stringify(d, null, 2);
    return { content: [{ type: 'text' as const, text }] };
  });

  // ---- persona_evolve ----
  server.tool('persona_evolve', '手动触发演化', {
    messageCount: z.number().optional(),
  }, async (params) => {
    const d = await post('/api/evolve', { messageCount: params.messageCount });
    return { content: [{ type: 'text' as const, text: `分析方法: ${d.method}\nState 变化: P=${d.state.pleasure.toFixed(3)} A=${d.state.arousal.toFixed(3)} D=${d.state.dominance.toFixed(3)}` }] };
  });

  // ---- persona_history ----
  server.tool('persona_history', '查看演化轨迹', {
    layer: z.enum(['trait', 'state', 'all']).optional(),
    limit: z.number().optional(),
    summary: z.boolean().optional(),
  }, async (params) => {
    const qs = `layer=${params.layer || 'all'}&limit=${params.limit || 20}&summary=${params.summary || false}`;
    const d = await api(`/api/history?${qs}`);
    if (!d.history || d.history.length === 0) return { content: [{ type: 'text' as const, text: '暂无演化历史。' }] };
    let text = d.history.map((h: any) => `[${new Date(h.timestamp).toLocaleString('zh-CN')}] ${h.layer} (${h.triggerType}) ${h.triggerSummary || ''}`).join('\n');
    if (d.analytics) {
      const a = d.analytics;
      text += `\n\n--- 趋势分析摘要 ---`;
      text += `\nPAD 趋势: P=${a.recentTrend.pleasure} A=${a.recentTrend.arousal} D=${a.recentTrend.dominance}`;
      text += `\n总演化次数: ${a.total}`;
    }
    return { content: [{ type: 'text' as const, text }] };
  });

  // ---- persona_relationship ----
  server.tool('persona_relationship', '查看关系模式', {}, async () => {
    const d = await api('/api/relationship');
    return { content: [{ type: 'text' as const, text: `互动次数: ${d.totalInteractions}\n平均语气: ${d.avgTone.toFixed(3)}\n信任度: ${d.trustLevel.toFixed(3)}\n互动风格: ${d.interactionStyle}` }] };
  });

  // ---- persona_config ----
  server.tool('persona_config', '查看或更新配置', {
    action: z.enum(['get', 'set']).optional(),
    evolve_every_n: z.number().optional(),
    emotional_inertia: z.number().optional(),
    state_decay_rate: z.number().optional(),
    trait_decay_rate: z.number().optional(),
    negativity_bias: z.number().optional(),
    llm_provider: z.enum(['anthropic', 'openai', 'ollama', 'none']).optional(),
    llm_api_key: z.string().optional(),
    llm_model: z.string().optional(),
    llm_base_url: z.string().optional(),
  }, async (params) => {
    if (params.action === 'set') {
      const body: any = {};
      const evo: any = {};
      if (params.evolve_every_n) evo.evolveEveryN = params.evolve_every_n;
      if (params.emotional_inertia) evo.emotionalInertia = params.emotional_inertia;
      if (params.state_decay_rate) evo.stateDecayRate = params.state_decay_rate;
      if (params.trait_decay_rate) evo.traitDecayRate = params.trait_decay_rate;
      if (params.negativity_bias) evo.negativityBias = params.negativity_bias;
      if (Object.keys(evo).length > 0) body.evolution = evo;
      if (params.llm_provider) body.llm = { provider: params.llm_provider, apiKey: params.llm_api_key, model: params.llm_model, baseUrl: params.llm_base_url };
      const d = await post('/api/config', body);
      return { content: [{ type: 'text' as const, text: JSON.stringify(d, null, 2) }] };
    }
    const d = await api('/api/config');
    return { content: [{ type: 'text' as const, text: JSON.stringify(d, null, 2) }] };
  });

  return server;
}
