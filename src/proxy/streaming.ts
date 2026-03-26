/**
 * SSE 流式处理：解析上游 SSE 流、转发到客户端、收集完整内容
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ChatCompletionChunk, ChatCompletionResponse } from './types.js';

/**
 * 从上游 fetch Response 解析 SSE 事件流
 */
export async function* parseSSEStream(
  response: Response,
): AsyncGenerator<ChatCompletionChunk | null> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // 保留最后可能不完整的行
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue; // 空行或注释

        if (trimmed === 'data: [DONE]') {
          yield null; // 标记结束
          return;
        }

        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6);
          try {
            yield JSON.parse(jsonStr) as ChatCompletionChunk;
          } catch {
            // 跳过无法解析的 SSE 行
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * 流式转发：边转发 SSE 边收集完整内容
 */
export async function streamToClient(
  upstreamRes: Response,
  clientRes: ServerResponse,
  onComplete: (fullContent: string) => void,
): Promise<void> {
  clientRes.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const contentParts: string[] = [];

  try {
    for await (const chunk of parseSSEStream(upstreamRes)) {
      if (chunk === null) {
        // [DONE]
        clientRes.write('data: [DONE]\n\n');
        break;
      }

      // 收集内容
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) {
        contentParts.push(delta.content);
      }

      // 转发原始 chunk
      clientRes.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
  } catch (err) {
    // 连接中断等错误，静默处理
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[norma-proxy] stream error: ${errMsg}`);
  } finally {
    clientRes.end();
    onComplete(contentParts.join(''));
  }
}

/**
 * 非流式转发：读取完整 JSON 响应，转发后回调
 */
export async function forwardNonStreaming(
  upstreamRes: Response,
  clientRes: ServerResponse,
  onComplete: (fullContent: string) => void,
): Promise<void> {
  try {
    const body = await upstreamRes.text();

    clientRes.writeHead(upstreamRes.status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    clientRes.end(body);

    // 提取完整内容
    try {
      const data = JSON.parse(body) as ChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content ?? '';
      onComplete(content);
    } catch {
      onComplete('');
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[norma-proxy] forward error: ${errMsg}`);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'Content-Type': 'application/json' });
      clientRes.end(JSON.stringify({ error: { message: 'upstream error', detail: errMsg } }));
    }
    onComplete('');
  }
}
