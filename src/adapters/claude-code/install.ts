// ============================================================
// Claude Code Adapter — 安装/注入指令
// 将人格指令注入到 CLAUDE.md 或全局 memory
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MARKER_START = '<!-- PERSONA-MEMORY-START -->';
const MARKER_END = '<!-- PERSONA-MEMORY-END -->';

/**
 * 读取 PERSONA_INSTRUCTIONS.md 模板
 */
function getInstructions(): string {
  const path = resolve(__dirname, 'PERSONA_INSTRUCTIONS.md');
  if (existsSync(path)) {
    return readFileSync(path, 'utf-8');
  }
  // 编译后可能在 dist/ 下，尝试从 src/ 读
  const srcPath = resolve(__dirname, '..', '..', 'src', 'adapters', 'claude-code', 'PERSONA_INSTRUCTIONS.md');
  if (existsSync(srcPath)) {
    return readFileSync(srcPath, 'utf-8');
  }
  throw new Error('PERSONA_INSTRUCTIONS.md not found');
}

/**
 * 将人格指令注入到指定的 CLAUDE.md 文件
 * 使用标记包裹，支持幂等更新
 */
export function injectIntoClaudeMd(claudeMdPath: string): boolean {
  const instructions = getInstructions();
  const block = `${MARKER_START}\n${instructions}\n${MARKER_END}`;

  if (existsSync(claudeMdPath)) {
    let content = readFileSync(claudeMdPath, 'utf-8');

    // 已存在则替换
    const startIdx = content.indexOf(MARKER_START);
    const endIdx = content.indexOf(MARKER_END);
    if (startIdx !== -1 && endIdx !== -1) {
      content = content.slice(0, startIdx) + block + content.slice(endIdx + MARKER_END.length);
    } else {
      content = content.trimEnd() + '\n\n' + block + '\n';
    }

    writeFileSync(claudeMdPath, content, 'utf-8');
  } else {
    mkdirSync(dirname(claudeMdPath), { recursive: true });
    writeFileSync(claudeMdPath, block + '\n', 'utf-8');
  }

  return true;
}

/**
 * 从 CLAUDE.md 中移除人格指令
 */
export function removeFromClaudeMd(claudeMdPath: string): boolean {
  if (!existsSync(claudeMdPath)) return false;

  let content = readFileSync(claudeMdPath, 'utf-8');
  const startIdx = content.indexOf(MARKER_START);
  const endIdx = content.indexOf(MARKER_END);

  if (startIdx === -1 || endIdx === -1) return false;

  content = content.slice(0, startIdx).trimEnd() + content.slice(endIdx + MARKER_END.length);
  writeFileSync(claudeMdPath, content.trim() + '\n', 'utf-8');
  return true;
}

/**
 * 注入到全局 CLAUDE.md
 */
export function installGlobal(): string {
  const globalPath = resolve(homedir(), '.claude', 'CLAUDE.md');
  injectIntoClaudeMd(globalPath);
  return globalPath;
}

/**
 * 注入到项目 CLAUDE.md
 */
export function installProject(projectDir: string): string {
  const projectPath = resolve(projectDir, 'CLAUDE.md');
  injectIntoClaudeMd(projectPath);
  return projectPath;
}

// CLI 入口
if (process.argv[1] && process.argv[1].includes('install')) {
  const target = process.argv[2] || 'global';
  if (target === 'global') {
    const path = installGlobal();
    console.log(`Persona instructions injected into: ${path}`);
  } else {
    const path = installProject(target);
    console.log(`Persona instructions injected into: ${path}`);
  }
}
