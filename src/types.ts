// ============================================================
// Norma（诺玛）— Core Type Definitions
// 心理学双层人格模型：OCEAN Traits + PAD States
// ============================================================

// ---- Big Five / OCEAN 人格特质 ----

export interface OceanTraits {
  openness: number;          // 开放性 [0, 1]
  conscientiousness: number; // 尽责性 [0, 1]
  extraversion: number;      // 外向性 [0, 1]
  agreeableness: number;     // 宜人性 [0, 1]
  neuroticism: number;       // 神经质 [0, 1]
}

export interface PersonaTraits extends OceanTraits {
  // 用户设定的初始基线（回归目标）
  baseline: OceanTraits;
  personalityName: string | null;
  personalityDesc: string | null;
  updatedAt: number;
  version: number;
}

// ---- PAD 情绪状态 ----

export interface PadState {
  pleasure: number;   // 愉悦度 [-1, 1]
  arousal: number;    // 唤醒度 [-1, 1]
  dominance: number;  // 支配度 [-1, 1]
}

export interface PersonaState extends PadState {
  updatedAt: number;
}

// ---- 关系模式 ----

export interface RelationshipPattern {
  avgTone: number;            // 用户平均语气 [-1, 1]
  conflictFrequency: number;  // 冲突频率 [0, 1]
  trustLevel: number;         // 信任度 [0, 1]
  interactionStyle: 'casual' | 'formal' | 'playful' | 'demanding';
  totalInteractions: number;
  updatedAt: number;
}

// ---- 对话记录 ----

export interface ConversationMessage {
  id: string;
  platform: string;
  sessionId: string | null;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  metadata: Record<string, unknown> | null;
}

// ---- 演化历史 ----

export type EvolutionLayer = 'trait' | 'state';
export type TriggerType = 'conversation' | 'manual' | 'decay';

export interface EvolutionRecord {
  id: number;
  layer: EvolutionLayer;
  values: OceanTraits | PadState;
  triggerType: TriggerType;
  triggerSummary: string | null;
  timestamp: number;
}

// ---- 情感分析结果 ----

export interface SentimentAnalysis {
  userTone: number;            // [-1, 1]
  emotionalIntensity: number;  // [0, 1]
  dominanceShift: number;      // [-1, 1]
  topicSentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
  interactionQuality: 'supportive' | 'neutral' | 'tense' | 'conflictual';
  notableEvents: string[];
  suggestedStateDelta: PadState;
}

// ---- 演化引擎配置 ----

export interface EvolutionConfig {
  // 情绪惯性系数 (0-1)，越高越保留上一刻情绪
  emotionalInertia: number;
  // 消极偏差倍数
  negativityBias: number;
  // State 基线回归速率 (per turn)
  stateDecayRate: number;
  // Trait 基线回归速率 (per day)
  traitDecayRate: number;
  // State → Trait 累积影响阈值（连续多少轮同方向偏移才影响 Trait）
  stateToTraitThreshold: number;
  // State → Trait 影响系数
  stateToTraitRate: number;
  // 享乐适应衰减因子
  hedonicAdaptationFactor: number;
  // 每 N 条消息触发一次演化分析
  evolveEveryN: number;
}

export const DEFAULT_EVOLUTION_CONFIG: EvolutionConfig = {
  emotionalInertia: 0.6,
  negativityBias: 2.5,
  stateDecayRate: 0.03,
  traitDecayRate: 0.002,
  stateToTraitThreshold: 20,
  stateToTraitRate: 0.005,
  hedonicAdaptationFactor: 0.15,
  evolveEveryN: 5,
};

export const DEFAULT_OCEAN: OceanTraits = {
  openness: 0.7,
  conscientiousness: 0.7,
  extraversion: 0.5,
  agreeableness: 0.7,
  neuroticism: 0.3,
};

export const DEFAULT_PAD: PadState = {
  pleasure: 0.2,
  arousal: 0.0,
  dominance: 0.0,
};

export const DEFAULT_RELATIONSHIP: RelationshipPattern = {
  avgTone: 0,
  conflictFrequency: 0,
  trustLevel: 0.5,
  interactionStyle: 'casual',
  totalInteractions: 0,
  updatedAt: Date.now(),
};

// ---- LLM 配置 ----

export type LlmProvider = 'anthropic' | 'openai' | 'ollama' | 'none';

export interface LlmConfig {
  provider: LlmProvider;
  apiKey?: string;       // Anthropic / OpenAI
  model?: string;        // 模型名，如 claude-sonnet-4-20250514, gpt-4o, llama3
  baseUrl?: string;      // Ollama 或自定义 endpoint
  temperature?: number;
}
