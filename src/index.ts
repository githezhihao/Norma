#!/usr/bin/env node
// ============================================================
// Norma（诺玛）— 入口
// 创建 PersonaEngine → 启动 MCP Server + HTTP API
// ============================================================

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PersonaEngine } from './core/persona-engine.js';
import { createServer } from './server.js';
import { createHttpApi } from './http-server.js';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

// 解析命令行参数
function parseArgs(): { dbPath: string; httpPort: number; noHttp: boolean; syncSoul: boolean } {
  const args = process.argv.slice(2);
  let dbPath = resolve(homedir(), '.norma', 'db.sqlite');
  let httpPort = 19820;
  let noHttp = false;
  let syncSoul = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db' && args[i + 1]) {
      const raw = args[i + 1];
      dbPath = raw.startsWith('~') ? raw.replace('~', homedir()) : resolve(raw);
      i++;
    } else if (args[i] === '--port' && args[i + 1]) {
      httpPort = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--no-http') {
      noHttp = true;
    } else if (args[i] === '--sync-soul') {
      syncSoul = true;
    }
  }

  return { dbPath, httpPort, noHttp, syncSoul };
}

async function main() {
  const { dbPath, httpPort, noHttp, syncSoul } = parseArgs();

  // Layer 1: 核心引擎
  const engine = new PersonaEngine(dbPath);
  await engine.initVec();

  // Layer 2a: MCP Server (stdio)
  const mcpServer = createServer(engine);
  const transport = new StdioServerTransport();

  // Layer 2b: HTTP API (可选)
  let httpServer: ReturnType<typeof createHttpApi> | null = null;
  if (!noHttp) {
    httpServer = createHttpApi(engine, httpPort);
  }

  // Layer 3: SOUL.md 同步 (可选，给 OpenClaw 用)
  let soulSyncTimer: NodeJS.Timeout | null = null;
  if (syncSoul && !noHttp) {
    const { startSoulSync } = await import('./adapters/openclaw/soul-sync.js');
    soulSyncTimer = startSoulSync(60_000);
  }

  // 优雅退出
  const cleanup = () => {
    if (soulSyncTimer) clearInterval(soulSyncTimer);
    httpServer?.close();
    engine.close();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  await mcpServer.connect(transport);
}

main().catch((err) => {
  console.error('norma failed to start:', err);
  process.exit(1);
});
