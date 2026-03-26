#!/usr/bin/env node
// ============================================================
// Norma Proxy — OpenAI 兼容透明 API 代理
// 人格注入 + 消息记录 + 情绪演化 自动完成
// 用法: norma-proxy --target-url https://api.openai.com/v1 --target-key sk-xxx [--port 19821]
// ============================================================

import { PersonaEngine } from './core/persona-engine.js';
import { loadProxyConfig } from './proxy/config.js';
import { createProxyServer } from './proxy/server.js';

async function main() {
  const config = loadProxyConfig();

  // 初始化 PersonaEngine
  const engine = new PersonaEngine(config.dbPath);
  await engine.initVec();

  // 自动配置 LLM 情感分析
  const llmProvider = process.env.NORMA_LLM_PROVIDER;
  if (llmProvider && llmProvider !== 'none') {
    // 显式配置优先
    engine.setLlmConfig({
      provider: llmProvider as 'anthropic' | 'openai' | 'ollama',
      apiKey: process.env.NORMA_LLM_API_KEY,
      model: process.env.NORMA_LLM_MODEL,
      baseUrl: process.env.NORMA_LLM_BASE_URL,
    });
  } else if (llmProvider !== 'none') {
    // 未显式配置 → 自动复用 target API（OpenAI 兼容）做情感分析
    engine.setLlmConfig({
      provider: 'openai',
      apiKey: config.targetApiKey,
      baseUrl: config.targetBaseUrl,
      model: process.env.NORMA_LLM_MODEL || 'qwen3.5-flash',
    });
    process.stderr.write(`[norma-proxy] LLM 情感分析已启用 (model: ${process.env.NORMA_LLM_MODEL || 'qwen3.5-flash'}, 复用 target API)\n`);
  }

  // 确保人格已初始化
  if (!engine.getTraits()) {
    engine.initPersona();
    process.stderr.write('[norma-proxy] 使用默认人格初始化\n');
  }

  const server = createProxyServer(engine, config);

  // 优雅关闭
  const cleanup = () => {
    process.stderr.write('[norma-proxy] 正在关闭...\n');
    server.close();
    engine.close();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error('[norma-proxy] 启动失败:', err);
  process.exit(1);
});
