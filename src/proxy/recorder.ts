/**
 * 异步消息录入器：fire-and-forget 消息记录 + 会话轮次追踪
 */

import type { PersonaEngine } from '../core/persona-engine.js';
import { log } from '../core/persona-engine.js';

export class AsyncRecorder {
  private turnCounts = new Map<string, number>();
  private engine: PersonaEngine;

  constructor(engine: PersonaEngine) {
    this.engine = engine;
  }

  /** 记录用户消息（fire-and-forget） */
  recordUserMessage(content: string, sessionId: string): void {
    this.incrementTurn(sessionId);
    log('DEBUG', 'recorder', `Recording user message for session ${sessionId}. Content length: ${content.length}`);
    this.engine
      .recordAndMaybeEvolve({
        role: 'user',
        content,
        platform: 'norma-proxy',
        sessionId,
      })
      .then(result => {
        log('DEBUG', 'recorder', `Successfully recorded user message for session ${sessionId}. Message ID: ${result.message.id}`);
        if (result.evolveResult) {
          const { analysis, analysisMethod, previousState, newState, traitChanged } = result.evolveResult;
          const dP = newState.pleasure - previousState.pleasure;
          const dA = newState.arousal - previousState.arousal;
          const dD = newState.dominance - previousState.dominance;
          log('INFO', 'evolution', `2️⃣ 情绪变化 (session: ${sessionId}): P: ${previousState.pleasure.toFixed(3)} → ${newState.pleasure.toFixed(3)} (Δ${dP >= 0 ? '+' : ''}${dP.toFixed(3)}) | A: ${previousState.arousal.toFixed(3)} → ${newState.arousal.toFixed(3)} (Δ${dA >= 0 ? '+' : ''}${dA.toFixed(3)}) | D: ${previousState.dominance.toFixed(3)} → ${newState.dominance.toFixed(3)} (Δ${dD >= 0 ? '+' : ''}${dD.toFixed(3)})`);
          log('INFO', 'evolution', `   分析方法: ${analysisMethod} | 话题情感: ${analysis.topicSentiment} | 互动质量: ${analysis.interactionQuality} | 情绪强度: ${analysis.emotionalIntensity.toFixed(2)} | 用户语气: ${analysis.userTone.toFixed(2)}`);
          if (analysis.notableEvents.length > 0) {
            log('INFO', 'evolution', `   关键事件: ${analysis.notableEvents.join(', ')}`);
          }
          if (traitChanged) {
            log('INFO', 'evolution', `   ⚠️ Trait基线发生变化！`);
          }
        }
      })
      .catch(err => {
        const errMsg = err instanceof Error ? err.message : String(err);
        log('ERR', 'recorder', `Record user message failed for session ${sessionId}: ${errMsg}`);
      });
  }

  /** 记录 AI 回复（fire-and-forget） */
  recordAssistantMessage(content: string, sessionId: string): void {
    if (!content) {
      log('DEBUG', 'recorder', `Skipping empty assistant message for session ${sessionId}`);
      return; // 空回复不记录
    }
    log('DEBUG', 'recorder', `Recording assistant message for session ${sessionId}. Content length: ${content.length}`);
    this.engine
      .recordAndMaybeEvolve({
        role: 'assistant',
        content,
        platform: 'norma-proxy',
        sessionId,
      })
      .then(result => {
        log('DEBUG', 'recorder', `Successfully recorded assistant message for session ${sessionId}. Message ID: ${result.message.id}`);
        if (result.evolveResult) {
          const { analysis, previousState, newState, traitChanged } = result.evolveResult;
          log('INFO', 'evolution', `State evolution triggered after assistant response for session ${sessionId}`);
          log('DEBUG', 'evolution', `Previous state - P:${previousState.pleasure.toFixed(3)} A:${previousState.arousal.toFixed(3)} D:${previousState.dominance.toFixed(3)}`);
          log('DEBUG', 'evolution', `New state - P:${newState.pleasure.toFixed(3)} A:${newState.arousal.toFixed(3)} D:${newState.dominance.toFixed(3)}`);
          log('DEBUG', 'evolution', `Analysis: ${JSON.stringify(analysis)}`);
          if (traitChanged) {
            log('INFO', 'evolution', `Trait evolution occurred after assistant response for session ${sessionId}`);
          }
        }
      })
      .catch(err => {
        const errMsg = err instanceof Error ? err.message : String(err);
        log('ERR', 'recorder', `Record assistant message failed for session ${sessionId}: ${errMsg}`);
      });
  }

  /** 获取当前会话轮次数 */
  getTurnCount(sessionId: string): number {
    return this.turnCounts.get(sessionId) ?? 0;
  }

  private incrementTurn(sessionId: string): void {
    const current = this.turnCounts.get(sessionId) ?? 0;
    this.turnCounts.set(sessionId, current + 1);
  }
}
