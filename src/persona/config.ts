// ============================================================
// 演化参数配置
// ============================================================

import type { EvolutionConfig } from '../types.js';
import { DEFAULT_EVOLUTION_CONFIG } from '../types.js';

let config: EvolutionConfig = { ...DEFAULT_EVOLUTION_CONFIG };

export function getConfig(): EvolutionConfig {
  return { ...config };
}

export function updateConfig(partial: Partial<EvolutionConfig>): EvolutionConfig {
  config = { ...config, ...partial };
  return getConfig();
}

export function resetConfig(): EvolutionConfig {
  config = { ...DEFAULT_EVOLUTION_CONFIG };
  return getConfig();
}
