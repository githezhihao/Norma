/**
 * 系统提示注入器：将人格状态、记忆、锚点注入到 messages 中
 *
 * 关键约束：只修改 system message，绝不动 user/assistant 消息
 */

import type { ChatMessage, InjectionContext } from './types.js';
import { log } from '../core/persona-engine.js';

/**
 * 将人格上下文注入到消息列表的 system message 中
 *
 * - Layer A (每次): personaPrompt — 当前人格状态描述
 * - Layer B (按需): memories — 相关历史记忆
 * - Layer C (定期): anchorPrompt — 完整人格锚点，防漂移
 */
export function injectPersona(
  messages: ChatMessage[],
  context: InjectionContext,
): ChatMessage[] {
  const injected = [...messages];
  const injection = buildInjectionBlock(context);

  if (!injection) return injected;

  const layers = `${context.personaPrompt ? 'A' : ''}${context.memories ? 'B' : ''}${context.anchorPrompt ? 'C' : ''}`;
  log('DEBUG', 'injector', `Injecting layers: [${layers}] (${injection.length} chars)`);

  const sysIdx = injected.findIndex(m => m.role === 'system');
  if (sysIdx >= 0) {
    const original = injected[sysIdx];
    injected[sysIdx] = {
      ...original,
      content: `${original.content ?? ''}\n\n${injection}`,
    };
  } else {
    injected.unshift({ role: 'system', content: injection });
  }

  return injected;
}

function buildInjectionBlock(context: InjectionContext): string | null {
  const parts: string[] = [];

  if (context.personaPrompt) {
    parts.push(`[Norma 人格状态]\n${context.personaPrompt}`);
  }
  if (context.memories) {
    parts.push(`[相关记忆]\n${context.memories}`);
  }
  if (context.anchorPrompt) {
    parts.push(`[人格锚点 — 请始终保持以下人格特征]\n${context.anchorPrompt}`);
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}
