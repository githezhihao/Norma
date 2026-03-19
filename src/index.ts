#!/usr/bin/env node
// ============================================================
// Norma（诺玛）— MCP 入口
// 自动检测 Core 服务是否运行：
//   - Core 在线 → MCP 代理模式（无状态，转发到 Core HTTP）
//   - Core 离线 → 自动启动 Core + MCP 直连模式
// ============================================================

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';

const NORMA_PORT = parseInt(process.env.NORMA_HTTP_PORT || '19820');
const NORMA_API = `http://127.0.0.1:${NORMA_PORT}`;

async function isCoreAlive(): Promise<boolean> {
  try {
    const res = await fetch(`${NORMA_API}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function startCore(): Promise<void> {
  const corePath = resolve(
    new URL('.', import.meta.url).pathname,
    'core-entry.js',
  );
  const dbPath = resolve(homedir(), '.norma', 'db.sqlite');

  // 传递 LLM 环境变量
  const env = { ...process.env };

  const child = spawn('node', [corePath, '--port', String(NORMA_PORT), '--db', dbPath], {
    detached: true,
    stdio: 'ignore',
    env,
  });
  child.unref();

  // 等待 Core 启动
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 300));
    if (await isCoreAlive()) return;
  }
  throw new Error('Norma Core failed to start within 6s');
}

async function main() {
  const coreAlive = await isCoreAlive();

  if (!coreAlive) {
    process.stderr.write('[norma] Core not running, starting...\n');
    await startCore();
    process.stderr.write('[norma] Core started\n');
  } else {
    process.stderr.write('[norma] Core already running\n');
  }

  // MCP 代理模式 — 所有操作转发到 Core HTTP
  const { createProxyServer } = await import('./mcp-proxy.js');
  const mcpServer = createProxyServer();
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`norma failed: ${err?.message || err}\n`);
  process.exit(1);
});
