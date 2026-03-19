// ============================================================
// OpenClaw Persona Hook Handler
// 拦截 message:received / message:sent，通过 HTTP 记录到
// Norma（诺玛），实现无感自动化人格演化
// ============================================================

const PERSONA_API = `http://127.0.0.1:${process.env.PERSONA_HTTP_PORT || '19820'}`;

interface HookEvent {
  type: string;
  action: string;
  sessionKey: string;
  context: Record<string, unknown>;
  timestamp: Date;
  messages: string[];
}

export default async function handler(event: HookEvent): Promise<void> {
  const { type, action, context } = event;

  if (type !== 'message') return;

  try {
    if (action === 'received') {
      await recordMessage('user', context);
    } else if (action === 'sent') {
      await recordMessage('assistant', context);
    }
  } catch {
    // 静默失败，不影响主消息流
  }
}

async function recordMessage(
  role: 'user' | 'assistant',
  context: Record<string, unknown>,
): Promise<void> {
  const content = (context.content as string) || (context.body as string) || '';
  if (!content.trim()) return;

  const channelId = (context.channelId as string) || 'openclaw';
  const sessionId = (context.conversationId as string) || (context.sessionKey as string) || undefined;

  const res = await fetch(`${PERSONA_API}/api/record`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role,
      content,
      platform: `openclaw:${channelId}`,
      sessionId,
    }),
    signal: AbortSignal.timeout(3000),
  });

  if (!res.ok) {
    // 可选：stderr 日志，不影响主流程
    process.stderr.write(`[persona-hook] record failed: ${res.status}\n`);
  }
}
