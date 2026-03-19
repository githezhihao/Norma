// ============================================================
// SOUL.md 同步 — 定期从 Norma 拉取人格状态
// 追加模式：只维护 SOUL.md 末尾的 Norma 标记区块
// 保留用户手写的核心人设内容不动
// ============================================================

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const PERSONA_API = `http://127.0.0.1:${process.env.PERSONA_HTTP_PORT || '19820'}`;
const SOUL_PATH = resolve(homedir(), '.openclaw', 'workspace', 'SOUL.md');

const BLOCK_START = '<!-- NORMA:BEGIN -->';
const BLOCK_END = '<!-- NORMA:END -->';

/**
 * 从 Norma HTTP API 拉取当前人格状态，追加/更新到 SOUL.md 末尾的标记区块
 */
export async function syncSoulMd(): Promise<boolean> {
  try {
    const res = await fetch(`${PERSONA_API}/api/state?format=prompt`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;

    const personaText = await res.text();
    const normaBlock = `${BLOCK_START}\n<!-- AUTO-SYNCED by Norma — 请勿手动编辑此区块 -->\n\n${personaText}\n${BLOCK_END}`;

    let existing = '';
    if (existsSync(SOUL_PATH)) {
      existing = readFileSync(SOUL_PATH, 'utf-8');
    }

    let newContent: string;
    const startIdx = existing.indexOf(BLOCK_START);
    const endIdx = existing.indexOf(BLOCK_END);

    if (startIdx >= 0 && endIdx > startIdx) {
      // 替换已有区块
      newContent = existing.slice(0, startIdx) + normaBlock + existing.slice(endIdx + BLOCK_END.length);
    } else {
      // 追加到末尾
      newContent = existing.trimEnd() + '\n\n' + normaBlock + '\n';
    }

    // 只在内容变化时写入
    if (newContent === existing) return true;

    writeFileSync(SOUL_PATH, newContent, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * 启动定期同步（每 60 秒）
 */
export function startSoulSync(intervalMs: number = 60_000): NodeJS.Timeout {
  // 立即同步一次
  syncSoulMd();
  return setInterval(syncSoulMd, intervalMs);
}
