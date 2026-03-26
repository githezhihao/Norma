/**
 * OpenAI Chat Completion API 类型定义（代理所需子集）
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  [key: string]: unknown;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  user?: string;
  [key: string]: unknown;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string | null;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  [key: string]: unknown;
}

export interface ChatCompletionChunkDelta {
  role?: string;
  content?: string | null;
  [key: string]: unknown;
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: ChatCompletionChunkDelta;
  finish_reason: string | null;
}

export interface ChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
  [key: string]: unknown;
}

/** 人格注入上下文 */
export interface InjectionContext {
  personaPrompt: string;
  memories?: string;
  anchorPrompt?: string;
  sessionId?: string;  // 添加 sessionId 属性
}
