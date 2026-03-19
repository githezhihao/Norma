// ============================================================
// Embedding 生成器
// 支持 OpenAI / Ollama embedding API，降级到简易 TF-IDF
// ============================================================

import type { LlmConfig } from '../types.js';

// 默认维度（OpenAI text-embedding-3-small = 1536, 但我们可以用更小的）
export const EMBEDDING_DIM = 256;

/**
 * 生成文本 embedding
 * 优先用 API，降级到本地 TF-IDF
 */
export async function generateEmbedding(
  text: string,
  config: LlmConfig | null,
): Promise<Float32Array> {
  if (config && config.provider !== 'none' && config.apiKey) {
    try {
      return await generateApiEmbedding(text, config);
    } catch {
      // 降级到本地
    }
  }
  return generateLocalEmbedding(text);
}

async function generateApiEmbedding(text: string, config: LlmConfig): Promise<Float32Array> {
  if (config.provider === 'openai') {
    return callOpenAIEmbedding(text, config);
  }
  if (config.provider === 'ollama') {
    return callOllamaEmbedding(text, config);
  }
  // Anthropic 没有 embedding API，降级
  return generateLocalEmbedding(text);
}

async function callOpenAIEmbedding(text: string, config: LlmConfig): Promise<Float32Array> {
  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  const res = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text.slice(0, 8000),
      dimensions: EMBEDDING_DIM,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI embedding error: ${res.status}`);
  const data = await res.json() as any;
  return new Float32Array(data.data[0].embedding);
}

async function callOllamaEmbedding(text: string, config: LlmConfig): Promise<Float32Array> {
  const baseUrl = config.baseUrl || 'http://localhost:11434';
  const res = await fetch(`${baseUrl}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model || 'nomic-embed-text',
      input: text.slice(0, 8000),
    }),
  });
  if (!res.ok) throw new Error(`Ollama embedding error: ${res.status}`);
  const data = await res.json() as any;
  const raw: number[] = data.embeddings?.[0] || [];
  // Ollama 维度可能不同，截断或填充到 EMBEDDING_DIM
  return normalizeToFixedDim(raw);
}

/**
 * 本地简易 embedding（字符 n-gram 哈希）
 * 不依赖任何外部服务，效果比 TF-IDF 好一点
 * 原理：把文本切成 n-gram，哈希到固定维度的向量上
 */
function generateLocalEmbedding(text: string): Float32Array {
  const vec = new Float32Array(EMBEDDING_DIM);
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();

  // 字符级 3-gram
  for (let i = 0; i < normalized.length - 2; i++) {
    const gram = normalized.slice(i, i + 3);
    const hash = simpleHash(gram);
    const idx = Math.abs(hash) % EMBEDDING_DIM;
    // 用 hash 的符号决定加减（模拟随机投影）
    vec[idx] += hash > 0 ? 1 : -1;
  }

  // 词级 unigram
  const words = normalized.split(/[\s,，。.!！?？;；:：]+/).filter(Boolean);
  for (const word of words) {
    const hash = simpleHash(word);
    const idx = Math.abs(hash) % EMBEDDING_DIM;
    vec[idx] += (hash > 0 ? 1 : -1) * 2; // 词级权重更高
  }

  // L2 归一化
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMBEDDING_DIM; i++) vec[i] /= norm;

  return vec;
}

function normalizeToFixedDim(raw: number[]): Float32Array {
  const vec = new Float32Array(EMBEDDING_DIM);
  for (let i = 0; i < Math.min(raw.length, EMBEDDING_DIM); i++) {
    vec[i] = raw[i];
  }
  // L2 归一化
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMBEDDING_DIM; i++) vec[i] /= norm;
  return vec;
}

/**
 * 简单字符串哈希（FNV-1a 变体）
 */
function simpleHash(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) | 0;
  }
  return hash;
}

/**
 * Float32Array → Buffer（给 better-sqlite3 用）
 */
export function embeddingToBuffer(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

/**
 * Buffer → Float32Array
 */
export function bufferToEmbedding(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}
