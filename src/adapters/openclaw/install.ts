// ============================================================
// OpenClaw Adapter 安装脚本
// 将 persona-hook 安装到 OpenClaw workspace
// ============================================================

import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function installOpenClawHook(): { hookDir: string; installed: boolean } {
  const hookDir = resolve(homedir(), '.openclaw', 'workspace', 'hooks', 'persona-hook');

  mkdirSync(hookDir, { recursive: true });

  // 复制 HOOK.md
  const hookMdSrc = resolve(__dirname, 'HOOK.md');
  const hookMdDst = resolve(hookDir, 'HOOK.md');
  if (existsSync(hookMdSrc)) {
    copyFileSync(hookMdSrc, hookMdDst);
  }

  // 复制 handler
  const handlerSrc = resolve(__dirname, 'handler.js');
  const handlerDst = resolve(hookDir, 'handler.js');
  if (existsSync(handlerSrc)) {
    copyFileSync(handlerSrc, handlerDst);
  }

  return { hookDir, installed: true };
}

// CLI 入口
if (process.argv[1] && process.argv[1].includes('install')) {
  const { hookDir } = installOpenClawHook();
  console.log(`persona-hook installed to: ${hookDir}`);
  console.log('Restart OpenClaw gateway to activate.');
}
