#!/usr/bin/env node
// ============================================================
// Norma Core — 有状态核心服务（守护进程）
// 持有唯一的 PersonaEngine + HTTP API
// 用法: norma-core [--port 19820] [--db path] [--sync-soul]
// ============================================================

import { PersonaEngine } from './core/persona-engine.js';
import { createHttpApi } from './http-server.js';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

function parseArgs() {
  const args = process.argv.slice(2);
  let dbPath = resolve(homedir(), '.norma', 'db.sqlite');
  let httpPort = 19820;
  let syncSoul = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db' && args[i + 1]) dbPath = resolve(args[++i]);
    else if (args[i] === '--port' && args[i + 1]) httpPort = parseInt(args[++i]);
    else if (args[i] === '--sync-soul') syncSoul = true;
  }
  return { dbPath, httpPort, syncSoul };
}

async function main() {
  const { dbPath, httpPort, syncSoul } = parseArgs();

  const engine = new PersonaEngine(dbPath);
  await engine.initVec();

  // 自动配置 LLM
  const llmProvider = process.env.NORMA_LLM_PROVIDER;
  if (llmProvider && llmProvider !== 'none') {
    engine.setLlmConfig({
      provider: llmProvider as any,
      apiKey: process.env.NORMA_LLM_API_KEY,
      model: process.env.NORMA_LLM_MODEL,
      baseUrl: process.env.NORMA_LLM_BASE_URL,
    });
  }

  const httpServer = createHttpApi(engine, httpPort);

  let soulSyncTimer: NodeJS.Timeout | null = null;
  if (syncSoul) {
    const { startSoulSync } = await import('./adapters/openclaw/soul-sync.js');
    soulSyncTimer = startSoulSync(60_000);
  }

  const cleanup = () => {
    if (soulSyncTimer) clearInterval(soulSyncTimer);
    httpServer.close();
    engine.close();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  process.stderr.write(`[norma-core] 核心服务已启动 (db: ${dbPath})\n`);
}

main().catch((err) => {
  console.error('norma-core failed:', err);
  process.exit(1);
});
