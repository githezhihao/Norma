import { describe, it, expect } from 'vitest';
import { injectPersona } from '../../src/proxy/injector.js';
import type { ChatMessage, InjectionContext } from '../../src/proxy/types.js';

describe('injectPersona', () => {
  const baseContext: InjectionContext = {
    personaPrompt: '当前心情不错，充满好奇',
  };

  it('在已有 system message 后追加人格状态', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: '你是一个助手' },
      { role: 'user', content: '你好' },
    ];

    const result = injectPersona(messages, baseContext);

    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('system');
    expect(result[0].content).toContain('你是一个助手');
    expect(result[0].content).toContain('[Norma 人格状态]');
    expect(result[0].content).toContain('当前心情不错');
  });

  it('无 system message 时在开头插入', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '你好' },
    ];

    const result = injectPersona(messages, baseContext);

    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('system');
    expect(result[0].content).toContain('[Norma 人格状态]');
    expect(result[1].role).toBe('user');
    expect(result[1].content).toBe('你好');
  });

  it('注入记忆段', () => {
    const context: InjectionContext = {
      personaPrompt: '心情平静',
      memories: '- [user] 之前讨论过旅行计划',
    };

    const messages: ChatMessage[] = [
      { role: 'system', content: '助手' },
      { role: 'user', content: '继续聊旅行' },
    ];

    const result = injectPersona(messages, context);
    expect(result[0].content).toContain('[相关记忆]');
    expect(result[0].content).toContain('旅行计划');
  });

  it('注入锚点段', () => {
    const context: InjectionContext = {
      personaPrompt: '心情愉快',
      anchorPrompt: '性格开放、友善',
    };

    const messages: ChatMessage[] = [
      { role: 'user', content: '你好' },
    ];

    const result = injectPersona(messages, context);
    expect(result[0].content).toContain('[人格锚点');
    expect(result[0].content).toContain('性格开放、友善');
  });

  it('不修改 user/assistant 消息', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: '系统' },
      { role: 'user', content: '用户消息' },
      { role: 'assistant', content: '助手回复' },
      { role: 'user', content: '第二条消息' },
    ];

    const result = injectPersona(messages, baseContext);

    expect(result[1].content).toBe('用户消息');
    expect(result[2].content).toBe('助手回复');
    expect(result[3].content).toBe('第二条消息');
  });

  it('不修改原始 messages 数组', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: '原始' },
      { role: 'user', content: '你好' },
    ];
    const original = JSON.parse(JSON.stringify(messages));

    injectPersona(messages, baseContext);

    expect(messages).toEqual(original);
  });

  it('空 personaPrompt 不注入', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '你好' },
    ];

    const result = injectPersona(messages, { personaPrompt: '' });
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
  });
});
