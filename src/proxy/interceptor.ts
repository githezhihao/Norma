/**
 * 请求编排器：整合注入、转发、记录的核心流程
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PersonaEngine } from '../core/persona-engine.js';
import type { ChatCompletionRequest, InjectionContext } from './types.js';
import type { ProxyConfig } from './config.js';
import { AsyncRecorder } from './recorder.js';
import { injectPersona } from './injector.js';
import { streamToClient, forwardNonStreaming } from './streaming.js';
import { log } from '../core/persona-engine.js';

const DEFAULT_SESSION = 'default';

/**
 * 处理 /v1/chat/completions 请求
 */
export async function handleChatCompletion(
  req: IncomingMessage,
  reqBody: ChatCompletionRequest,
  clientRes: ServerResponse,
  engine: PersonaEngine,
  recorder: AsyncRecorder,
  config: ProxyConfig,
): Promise<void> {
  // 1. 提取用户最后一条消息
  const lastUserMsg = [...reqBody.messages].reverse().find(m => m.role === 'user');
  const userContent = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';

  // 2. 确定 sessionId
  const sessionId =
    reqBody.user ||
    req.headers['x-norma-session'] as string ||
    DEFAULT_SESSION;

  // ========== 1️⃣ 用户输入文本 ==========
  log('INFO', 'interceptor', `=== 对话轮次开始 (session: ${sessionId}) ===`);
  log('INFO', 'interceptor', `1️⃣ 用户输入: "${userContent}"`);
  log('DEBUG', 'interceptor', `Model: ${reqBody.model}, Stream: ${reqBody.stream}, Messages: ${reqBody.messages.length}`);

  // 3. 记录用户消息（异步触发情绪演化，2️⃣ 情绪变化在 recorder 回调中记录）
  if (userContent) {
    recorder.recordUserMessage(userContent, sessionId);
  }

  // 4. 构建注入上下文
  let messages = reqBody.messages;
  if (config.injectionEnabled) {
    const injCtx = await buildInjectionContext(engine, recorder, config, sessionId, userContent);
    messages = injectPersona(messages, injCtx);

    // ========== 3️⃣ 注入后的 Prompt ==========
    const systemMsg = messages.find(m => m.role === 'system');
    if (systemMsg && typeof systemMsg.content === 'string') {
      log('INFO', 'interceptor', `3️⃣ 注入后的Prompt (${systemMsg.content.length}字):`);
      log('INFO', 'interceptor', systemMsg.content);
    }
  }

  // 5. 构建上游请求
  const upstreamUrl = `${config.targetBaseUrl}/chat/completions`;
  const upstreamBody = { ...reqBody, messages };

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.targetApiKey}`,
      },
      body: JSON.stringify(upstreamBody),
    });
    log('DEBUG', 'interceptor', `Upstream response: ${upstreamRes.status}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log('ERR', 'interceptor', `Upstream fetch failed: ${errMsg}`);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'Content-Type': 'application/json' });
      clientRes.end(JSON.stringify({
        error: { message: 'Failed to connect to upstream LLM API', detail: errMsg },
      }));
    }
    return;
  }

  // 6. 上游返回非 2xx 则透传错误
  if (!upstreamRes.ok && !reqBody.stream) {
    const errBody = await upstreamRes.text();
    log('ERR', 'interceptor', `Upstream error: ${upstreamRes.status} - ${errBody.substring(0, 200)}`);
    clientRes.writeHead(upstreamRes.status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    clientRes.end(errBody);
    return;
  }

  // 7. 转发响应 + 记录结果
  const onComplete = (fullContent: string) => {
    recorder.recordAssistantMessage(fullContent, sessionId);

    // ========== 4️⃣ LLM 返回结果 ==========
    log('INFO', 'interceptor', `4️⃣ LLM返回: "${fullContent}"`);
    log('INFO', 'interceptor', `=== 对话轮次结束 (session: ${sessionId}) ===`);
  };

  if (reqBody.stream) {
    await streamToClient(upstreamRes, clientRes, onComplete);
  } else {
    await forwardNonStreaming(upstreamRes, clientRes, onComplete);
  }
}

async function buildInjectionContext(
  engine: PersonaEngine,
  recorder: AsyncRecorder,
  config: ProxyConfig,
  sessionId: string,
  userContent: string,
): Promise<InjectionContext> {
  const personaPrompt = engine.narrateState('prompt');

  // Layer B: 相关记忆（按需）
  let memories: string | undefined;
  if (config.memoryRecallEnabled && userContent) {
    try {
      const results = await engine.recall(userContent, 5);
      const relevant = results.filter(r => r.relevance >= config.memoryThreshold);
      if (relevant.length > 0) {
        const lines = relevant.map(r =>
          `- [${r.message.role}] ${truncate(r.message.content, 200)}`
        );
        const text = lines.join('\n');
        if (text.length / 4 <= config.memoryMaxTokens) {
          memories = text;
        } else {
          memories = text.slice(0, config.memoryMaxTokens * 4);
        }
      }
    } catch {
      // 记忆召回失败不阻塞请求
    }
  }

  // Layer C: 完整锚点（每 N 轮）
  let anchorPrompt: string | undefined;
  const turnCount = recorder.getTurnCount(sessionId);
  if (turnCount > 0 && turnCount % config.anchorInterval === 0) {
    anchorPrompt = engine.narrateState('prompt');
  }

  return { personaPrompt, memories, anchorPrompt, sessionId };
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}
