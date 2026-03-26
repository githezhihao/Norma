import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AsyncRecorder } from '../../src/proxy/recorder.js';
import { PersonaEngine } from '../../src/core/persona-engine.js';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

let engine: PersonaEngine;
let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `proxy-recorder-test-${randomUUID()}`);
  mkdirSync(testDir, { recursive: true });
  engine = new PersonaEngine(join(testDir, 'test.sqlite'));
  engine.initPersona('TestBot');
});

afterEach(() => {
  engine.close();
  rmSync(testDir, { recursive: true, force: true });
});

describe('AsyncRecorder', () => {
  it('recordUserMessage 不阻塞', () => {
    const recorder = new AsyncRecorder(engine);

    // fire-and-forget: 不应抛异常
    recorder.recordUserMessage('你好', 'session-1');
    recorder.recordUserMessage('世界', 'session-1');

    expect(recorder.getTurnCount('session-1')).toBe(2);
  });

  it('recordAssistantMessage 跳过空内容', () => {
    const recorder = new AsyncRecorder(engine);
    const spy = vi.spyOn(engine, 'recordAndMaybeEvolve');

    recorder.recordAssistantMessage('', 'session-1');

    expect(spy).not.toHaveBeenCalled();
  });

  it('recordAssistantMessage 记录非空内容', () => {
    const recorder = new AsyncRecorder(engine);
    const spy = vi.spyOn(engine, 'recordAndMaybeEvolve');

    recorder.recordAssistantMessage('回复内容', 'session-1');

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'assistant',
        content: '回复内容',
        sessionId: 'session-1',
      }),
    );
  });

  it('轮次计数按 session 隔离', () => {
    const recorder = new AsyncRecorder(engine);

    recorder.recordUserMessage('a', 'session-1');
    recorder.recordUserMessage('b', 'session-1');
    recorder.recordUserMessage('c', 'session-2');

    expect(recorder.getTurnCount('session-1')).toBe(2);
    expect(recorder.getTurnCount('session-2')).toBe(1);
    expect(recorder.getTurnCount('session-3')).toBe(0);
  });

  it('引擎报错不抛出', async () => {
    const recorder = new AsyncRecorder(engine);
    vi.spyOn(engine, 'recordAndMaybeEvolve').mockRejectedValue(new Error('DB error'));

    // 不应抛出
    recorder.recordUserMessage('test', 'session-1');

    // 等 promise settle
    await new Promise(r => setTimeout(r, 50));

    expect(recorder.getTurnCount('session-1')).toBe(1);
  });
});
