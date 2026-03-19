// ============================================================
// MCP Server — Layer 2 协议层
// 接收 PersonaEngine 实例，注册 MCP tools
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { PersonaEngine } from './core/persona-engine.js';
import type { OceanTraits } from './types.js';
import { DEFAULT_OCEAN } from './types.js';

export function createServer(engine: PersonaEngine): McpServer {
  const server = new McpServer({
    name: 'norma',
    version: '0.2.0',
  });

  // ---- persona_init ----
  server.tool(
    'persona_init',
    '初始化人格：设定 OCEAN 基线、名称和描述。如果已初始化则更新。',
    {
      name: z.string().optional().describe('人格名称，如"小云"'),
      description: z.string().optional().describe('人格描述'),
      openness: z.number().min(0).max(1).optional().describe('开放性 [0,1]'),
      conscientiousness: z.number().min(0).max(1).optional().describe('尽责性 [0,1]'),
      extraversion: z.number().min(0).max(1).optional().describe('外向性 [0,1]'),
      agreeableness: z.number().min(0).max(1).optional().describe('宜人性 [0,1]'),
      neuroticism: z.number().min(0).max(1).optional().describe('神经质 [0,1]'),
    },
    async (params) => {
      const ocean: Partial<OceanTraits> = {};
      if (params.openness !== undefined) ocean.openness = params.openness;
      if (params.conscientiousness !== undefined) ocean.conscientiousness = params.conscientiousness;
      if (params.extraversion !== undefined) ocean.extraversion = params.extraversion;
      if (params.agreeableness !== undefined) ocean.agreeableness = params.agreeableness;
      if (params.neuroticism !== undefined) ocean.neuroticism = params.neuroticism;

      const result = engine.initPersona(params.name, params.description, ocean);
      return {
        content: [{
          type: 'text' as const,
          text: `人格已初始化：${result.personalityName || '未命名'}\n` +
            `OCEAN: O=${result.openness.toFixed(2)} C=${result.conscientiousness.toFixed(2)} ` +
            `E=${result.extraversion.toFixed(2)} A=${result.agreeableness.toFixed(2)} N=${result.neuroticism.toFixed(2)}\n` +
            `版本: ${result.version}`,
        }],
      };
    },
  );

  // ---- persona_record ----
  server.tool(
    'persona_record',
    '记录一条对话消息。每 N 条消息自动触发演化分析。',
    {
      role: z.enum(['user', 'assistant']).describe('消息角色'),
      content: z.string().describe('消息内容'),
      platform: z.string().optional().describe('平台标识，如 openclaw / claude-code'),
      sessionId: z.string().optional().describe('会话 ID'),
    },
    async (params) => {
      const { message, evolveResult } = await engine.recordAndMaybeEvolve({
        role: params.role,
        content: params.content,
        platform: params.platform,
        sessionId: params.sessionId,
      });

      let text = `已记录 [${message.role}] 消息 (${message.id.slice(0, 8)})`;
      if (evolveResult) {
        text += `\n演化已触发 [${evolveResult.analysisMethod}]：P=${evolveResult.newState.pleasure.toFixed(3)} A=${evolveResult.newState.arousal.toFixed(3)} D=${evolveResult.newState.dominance.toFixed(3)}`;
        if (evolveResult.traitChanged) text += ' (Trait 层已更新)';
      }

      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // ---- persona_recall ----
  server.tool(
    'persona_recall',
    '检索相关历史对话上下文（FTS5 全文检索 + 时间衰减）',
    {
      query: z.string().describe('检索关键词或短语'),
      limit: z.number().optional().describe('返回条数，默认 10'),
    },
    async (params) => {
      const results = await engine.recall(params.query, params.limit ?? 10);
      if (results.length === 0) {
        return { content: [{ type: 'text' as const, text: '未找到相关历史对话。' }] };
      }

      const lines = results.map((r, i) => {
        const time = new Date(r.message.timestamp).toLocaleString('zh-CN');
        return `${i + 1}. [${r.message.role}] (${time}, 相关度: ${r.relevance.toFixed(3)})\n   ${r.message.content.slice(0, 200)}`;
      });

      return {
        content: [{
          type: 'text' as const,
          text: `找到 ${results.length} 条相关记录：\n\n${lines.join('\n\n')}`,
        }],
      };
    },
  );

  // ---- persona_state ----
  server.tool(
    'persona_state',
    '获取当前完整人格状态。format=prompt 返回自然语言描述，format=json 返回结构化数据，format=full 返回结构化数据+演化分析+运行指标。',
    {
      format: z.enum(['prompt', 'json', 'full']).optional().describe('输出格式，默认 prompt'),
    },
    async (params) => {
      const format = params.format ?? 'prompt';
      if (format === 'full') {
        const jsonText = engine.narrateState('json');
        const parsed = JSON.parse(jsonText);
        const metrics = engine.getMetrics();
        const analytics = engine.getEvolutionAnalytics();
        const full = { ...parsed, metrics, evolution: analytics };
        return { content: [{ type: 'text' as const, text: JSON.stringify(full, null, 2) }] };
      }
      const text = engine.narrateState(format as 'prompt' | 'json');
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // ---- persona_evolve ----
  server.tool(
    'persona_evolve',
    '手动触发一次演化分析（基于最近 N 条消息）',
    {
      messageCount: z.number().optional().describe('分析最近多少条消息，默认使用配置值'),
    },
    async (params) => {
      const cfg = engine.getConfig();
      const n = params.messageCount ?? cfg.evolveEveryN;
      const messages = engine.getRecentUserMessages(n);

      if (messages.length === 0) {
        return { content: [{ type: 'text' as const, text: '没有可分析的消息。' }] };
      }

      const result = await engine.evolve(messages, 'manual');
      const lines = [
        `分析方法: ${result.analysisMethod}`,
        `分析消息数: ${messages.length}`,
        `情感基调: ${result.analysis.topicSentiment} (tone: ${result.analysis.userTone.toFixed(3)})`,
        `情绪强度: ${result.analysis.emotionalIntensity.toFixed(3)}`,
        `State 变化: P ${result.previousState.pleasure.toFixed(3)} → ${result.newState.pleasure.toFixed(3)}, ` +
          `A ${result.previousState.arousal.toFixed(3)} → ${result.newState.arousal.toFixed(3)}, ` +
          `D ${result.previousState.dominance.toFixed(3)} → ${result.newState.dominance.toFixed(3)}`,
      ];
      if (result.analysis.notableEvents.length > 0) {
        lines.push(`事件: ${result.analysis.notableEvents.join(', ')}`);
      }
      if (result.traitChanged && result.newTraits) {
        lines.push(`Trait 已更新: O=${result.newTraits.openness.toFixed(3)} C=${result.newTraits.conscientiousness.toFixed(3)} E=${result.newTraits.extraversion.toFixed(3)} A=${result.newTraits.agreeableness.toFixed(3)} N=${result.newTraits.neuroticism.toFixed(3)}`);
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );

  // ---- persona_history ----
  server.tool(
    'persona_history',
    '查看人格演化轨迹。summary=true 时在末尾附加趋势分析摘要。',
    {
      limit: z.number().optional().describe('返回条数，默认 20'),
      layer: z.enum(['trait', 'state', 'all']).optional().describe('筛选层，默认 all'),
      summary: z.boolean().optional().describe('是否附加趋势分析摘要，默认 false'),
    },
    async (params) => {
      const records = engine.getHistory(params.layer ?? 'all', params.limit ?? 20);
      if (records.length === 0) {
        return { content: [{ type: 'text' as const, text: '暂无演化历史。' }] };
      }

      const lines = records.map(rec => {
        const time = new Date(rec.timestamp).toLocaleString('zh-CN');
        const values = rec.values as any;
        const valStr = rec.layer === 'state'
          ? `P=${values.pleasure?.toFixed(3)} A=${values.arousal?.toFixed(3)} D=${values.dominance?.toFixed(3)}`
          : `O=${values.openness?.toFixed(3)} C=${values.conscientiousness?.toFixed(3)} E=${values.extraversion?.toFixed(3)} A=${values.agreeableness?.toFixed(3)} N=${values.neuroticism?.toFixed(3)}`;
        return `[${time}] ${rec.layer.toUpperCase()} (${rec.triggerType}) ${valStr}${rec.triggerSummary ? ' — ' + rec.triggerSummary : ''}`;
      });

      let text = `演化历史 (${records.length} 条)：\n\n${lines.join('\n')}`;

      if (params.summary) {
        const analytics = engine.getEvolutionAnalytics();
        const trend = analytics.recentTrend;
        const vol = analytics.volatility;
        const tb = analytics.triggerBreakdown;
        text += '\n\n--- 趋势分析摘要 ---';
        text += `\nPAD 趋势: P=${trend.pleasure} A=${trend.arousal} D=${trend.dominance}`;
        text += `\n波动性: P=${vol.pleasure.toFixed(4)} A=${vol.arousal.toFixed(4)} D=${vol.dominance.toFixed(4)}`;
        text += `\n触发分布: 对话=${tb.conversation} 手动=${tb.manual} 衰减=${tb.decay}`;
        text += `\n总演化次数: ${analytics.total} (State: ${analytics.stateCount}, Trait: ${analytics.traitCount})`;
        if (analytics.lastEvolutionAt) text += `\n最后演化: ${analytics.lastEvolutionAt}`;
      }

      return {
        content: [{
          type: 'text' as const,
          text,
        }],
      };
    },
  );

  // ---- persona_relationship ----
  server.tool(
    'persona_relationship',
    '查看当前关系模式',
    {},
    async () => {
      const rel = engine.getRelationship();
      const text = [
        `互动次数: ${rel.totalInteractions}`,
        `平均语气: ${rel.avgTone.toFixed(3)} (${rel.avgTone > 0.1 ? '偏正面' : rel.avgTone < -0.1 ? '偏负面' : '中性'})`,
        `冲突频率: ${rel.conflictFrequency.toFixed(3)}`,
        `信任度: ${rel.trustLevel.toFixed(3)}`,
        `互动风格: ${rel.interactionStyle}`,
      ].join('\n');

      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // ---- persona_config ----
  server.tool(
    'persona_config',
    '查看或更新演化配置和 LLM 设置',
    {
      action: z.enum(['get', 'set']).optional().describe('操作类型，默认 get'),
      llm_provider: z.enum(['anthropic', 'openai', 'ollama', 'none']).optional().describe('LLM 提供商'),
      llm_api_key: z.string().optional().describe('API Key'),
      llm_model: z.string().optional().describe('模型名称'),
      llm_base_url: z.string().optional().describe('自定义 API 地址（Ollama 等）'),
      evolve_every_n: z.number().optional().describe('每 N 条消息触发演化'),
      emotional_inertia: z.number().optional().describe('情绪惯性系数 [0,1]'),
      negativity_bias: z.number().optional().describe('消极偏差倍数'),
      state_decay_rate: z.number().optional().describe('State 基线回归速率'),
      trait_decay_rate: z.number().optional().describe('Trait 基线回归速率'),
    },
    async (params) => {
      if (params.action === 'set') {
        // LLM 配置
        if (params.llm_provider) {
          if (params.llm_provider === 'none') {
            engine.setLlmConfig(null);
          } else {
            const current = engine.getLlmConfig();
            engine.setLlmConfig({
              provider: params.llm_provider,
              apiKey: params.llm_api_key ?? current?.apiKey,
              model: params.llm_model ?? current?.model,
              baseUrl: params.llm_base_url ?? current?.baseUrl,
            });
          }
        }

        // 演化参数
        const updates: Record<string, number> = {};
        if (params.evolve_every_n !== undefined) updates.evolveEveryN = params.evolve_every_n;
        if (params.emotional_inertia !== undefined) updates.emotionalInertia = params.emotional_inertia;
        if (params.negativity_bias !== undefined) updates.negativityBias = params.negativity_bias;
        if (params.state_decay_rate !== undefined) updates.stateDecayRate = params.state_decay_rate;
        if (params.trait_decay_rate !== undefined) updates.traitDecayRate = params.trait_decay_rate;
        if (Object.keys(updates).length > 0) engine.updateConfig(updates);
      }

      const cfg = engine.getConfig();
      const llm = engine.getLlmConfig();
      const text = [
        '=== 演化配置 ===',
        `情绪惯性: ${cfg.emotionalInertia}`,
        `消极偏差: ${cfg.negativityBias}x`,
        `State 回归速率: ${cfg.stateDecayRate}/轮`,
        `Trait 回归速率: ${cfg.traitDecayRate}/天`,
        `State→Trait 阈值: ${cfg.stateToTraitThreshold} 轮`,
        `State→Trait 系数: ${cfg.stateToTraitRate}`,
        `享乐适应因子: ${cfg.hedonicAdaptationFactor}`,
        `演化触发间隔: 每 ${cfg.evolveEveryN} 条消息`,
        '',
        '=== LLM 配置 ===',
        llm ? `提供商: ${llm.provider}\n模型: ${llm.model || '默认'}\n地址: ${llm.baseUrl || '默认'}` : '未配置（使用规则分析）',
        '',
        '=== 向量检索 ===',
        `sqlite-vec: ${engine.isVecEnabled() ? '已启用' : '未启用'}`,
      ].join('\n');

      return { content: [{ type: 'text' as const, text }] };
    },
  );

  return server;
}
