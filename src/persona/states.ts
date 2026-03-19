// ============================================================
// PAD State 层 — 情绪状态管理
// ============================================================

import type Database from 'better-sqlite3';
import type { PadState, PersonaState } from '../types.js';
import { DEFAULT_PAD } from '../types.js';

export function getState(db: Database.Database): PersonaState | null {
  const row = db.prepare('SELECT * FROM persona_state WHERE id = 1').get() as any;
  if (!row) return null;
  return {
    pleasure: row.pleasure,
    arousal: row.arousal,
    dominance: row.dominance,
    updatedAt: row.updated_at,
  };
}

export function upsertState(
  db: Database.Database,
  state: PadState,
): PersonaState {
  const now = Date.now();
  db.prepare(`
    INSERT INTO persona_state (id, pleasure, arousal, dominance, updated_at)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      pleasure=excluded.pleasure, arousal=excluded.arousal,
      dominance=excluded.dominance, updated_at=excluded.updated_at
  `).run(state.pleasure, state.arousal, state.dominance, now);

  return getState(db)!;
}

export function initStateIfNeeded(
  db: Database.Database,
  initial?: Partial<PadState>,
): PersonaState {
  const existing = getState(db);
  if (existing) return existing;

  const state: PadState = { ...DEFAULT_PAD, ...initial };
  return upsertState(db, state);
}
