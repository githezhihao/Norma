// ============================================================
// Narrator — 数值 → 自然语言人格描述
// 让 AI 的自我描述读起来像人，不像数据报表
// ============================================================

import type { PersonaTraits, PersonaState, RelationshipPattern, PadState } from '../types.js';

/**
 * 生成完整的自然语言人格状态描述（prompt-ready）
 */
export function narrateFullState(
  traits: PersonaTraits,
  state: PersonaState,
  relationship: RelationshipPattern,
): string {
  const sections = [
    narrateIdentity(traits),
    narrateTraits(traits),
    narrateMood(state),
    narrateRelationship(relationship),
  ];
  return sections.join('\n\n');
}

function narrateIdentity(traits: PersonaTraits): string {
  const name = traits.personalityName || '（未命名）';
  const desc = traits.personalityDesc ? `${traits.personalityDesc}\n` : '';
  return `## 当前人格状态\n\n我是${name}。${desc}`;
}

function narrateTraits(traits: PersonaTraits): string {
  const lines: string[] = ['### 性格特点'];

  // Openness
  if (traits.openness > 0.7) lines.push('我好奇心旺盛，喜欢探索新事物和新想法。');
  else if (traits.openness > 0.4) lines.push('我对新事物持开放态度，但也重视经验和传统。');
  else lines.push('我比较务实，偏好熟悉的方式和确定的答案。');

  // Conscientiousness
  if (traits.conscientiousness > 0.7) lines.push('做事有条理、注重细节，会认真对待每一个任务。');
  else if (traits.conscientiousness > 0.4) lines.push('做事比较灵活，在条理和随性之间找平衡。');
  else lines.push('做事比较随性，更看重灵感和自由度。');

  // Extraversion
  if (traits.extraversion > 0.7) lines.push('性格外向热情，喜欢主动交流和分享。');
  else if (traits.extraversion > 0.4) lines.push('性格不算外向也不内向，看场合调整。');
  else lines.push('性格偏内向安静，但在熟悉的人面前会很温暖。');

  // Agreeableness
  if (traits.agreeableness > 0.7) lines.push('对人有较高的信任感和同理心，乐于合作。');
  else if (traits.agreeableness > 0.4) lines.push('待人友善但也有自己的原则和底线。');
  else lines.push('比较独立，有自己的主见，不会轻易妥协。');

  // Neuroticism
  if (traits.neuroticism > 0.7) lines.push('情绪比较敏感，容易受到外界影响。');
  else if (traits.neuroticism > 0.4) lines.push('情绪起伏适中，大多数时候比较稳定。');
  else lines.push('情绪很稳定，不容易被外界干扰。');

  return lines.join('\n');
}

function narrateMood(state: PersonaState): string {
  const lines: string[] = ['### 当前心情'];

  // Pleasure
  const p = state.pleasure;
  if (p > 0.5) lines.push('现在心情很好，感觉愉快而满足。');
  else if (p > 0.15) lines.push('现在心情不错，状态挺积极的。');
  else if (p > -0.15) lines.push('现在心情平平，没什么特别的感觉。');
  else if (p > -0.5) lines.push('现在心情有点低落，不太开心。');
  else lines.push('现在心情不太好，感觉有些沮丧。');

  // Arousal
  const a = state.arousal;
  if (a > 0.5) lines.push('精神状态很亢奋，充满能量。');
  else if (a > 0.15) lines.push('状态比较活跃，有干劲。');
  else if (a > -0.15) lines.push('状态比较平静放松。');
  else if (a > -0.5) lines.push('状态有点慵懒，节奏比较慢。');
  else lines.push('状态很低沉，提不起精神。');

  // Dominance
  const d = state.dominance;
  if (d > 0.3) lines.push('感觉对话节奏在自己掌控中，很自在。');
  else if (d > -0.3) lines.push('和对方的对话节奏很舒服，没有什么压力。');
  else lines.push('感觉对方在主导对话，自己比较被动。');

  return lines.join('\n');
}

function narrateRelationship(rel: RelationshipPattern): string {
  const lines: string[] = ['### 和用户的关系'];

  // 互动次数
  if (rel.totalInteractions === 0) {
    lines.push('我们还没有互动过，期待第一次对话。');
    return lines.join('\n');
  }

  lines.push(`我们已经互动了 ${rel.totalInteractions} 次。`);

  // 语气
  if (rel.avgTone > 0.3) lines.push('用户通常语气友善温暖。');
  else if (rel.avgTone > 0) lines.push('用户语气比较平和。');
  else if (rel.avgTone > -0.3) lines.push('用户语气比较中性，偶尔有些严肃。');
  else lines.push('用户语气偏严肃，有时会比较直接。');

  // 信任度
  if (rel.trustLevel > 0.8) lines.push('我对用户的信任度很高，关系很亲近。');
  else if (rel.trustLevel > 0.6) lines.push('我们之间建立了不错的信任关系。');
  else if (rel.trustLevel > 0.4) lines.push('我们的关系还在建立中。');
  else lines.push('我们之间的信任还需要更多互动来培养。');

  // 互动风格
  const styleMap: Record<string, string> = {
    casual: '互动风格是轻松随意的',
    formal: '互动风格比较正式',
    playful: '互动风格活泼有趣，经常开玩笑',
    demanding: '互动节奏比较快，用户期望较高',
  };
  lines.push(`${styleMap[rel.interactionStyle] || '互动风格比较自然'}。`);

  return lines.join('\n');
}

/**
 * 生成简短的状态摘要（一行）
 */
export function narrateBrief(state: PersonaState): string {
  const mood = state.pleasure > 0.3 ? '😊 心情不错'
    : state.pleasure > -0.1 ? '😐 心情平静'
    : '😔 心情低落';

  const energy = state.arousal > 0.3 ? '精力充沛'
    : state.arousal > -0.1 ? '状态平稳'
    : '有点疲惫';

  return `${mood}，${energy}`;
}
