// ============================================================
// OCEAN Trait 层 — 人格特质管理
// ============================================================

import type Database from 'better-sqlite3';
import type { OceanTraits, PersonaTraits } from '../types.js';
import { DEFAULT_OCEAN } from '../types.js';

export function getTraits(db: Database.Database): PersonaTraits | null {
  const row = db.prepare('SELECT * FROM persona_traits WHERE id = 1').get() as any;
  if (!row) return null;
  return {
    openness: row.openness,
    conscientiousness: row.conscientiousness,
    extraversion: row.extraversion,
    agreeableness: row.agreeableness,
    neuroticism: row.neuroticism,
    baseline: {
      openness: row.baseline_o,
      conscientiousness: row.baseline_c,
      extraversion: row.baseline_e,
      agreeableness: row.baseline_a,
      neuroticism: row.baseline_n,
    },
    personalityName: row.personality_name,
    personalityDesc: row.personality_desc,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export function upsertTraits(
  db: Database.Database,
  traits: OceanTraits,
  baseline: OceanTraits,
  name?: string | null,
  desc?: string | null,
): PersonaTraits {
  const now = Date.now();
  const existing = getTraits(db);
  const version = existing ? existing.version + 1 : 1;

  db.prepare(`
    INSERT INTO persona_traits (id, openness, conscientiousness, extraversion, agreeableness, neuroticism,
      baseline_o, baseline_c, baseline_e, baseline_a, baseline_n,
      personality_name, personality_desc, updated_at, version)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      openness=excluded.openness, conscientiousness=excluded.conscientiousness,
      extraversion=excluded.extraversion, agreeableness=excluded.agreeableness,
      neuroticism=excluded.neuroticism,
      baseline_o=excluded.baseline_o, baseline_c=excluded.baseline_c,
      baseline_e=excluded.baseline_e, baseline_a=excluded.baseline_a,
      baseline_n=excluded.baseline_n,
      personality_name=excluded.personality_name, personality_desc=excluded.personality_desc,
      updated_at=excluded.updated_at, version=excluded.version
  `).run(
    traits.openness, traits.conscientiousness, traits.extraversion,
    traits.agreeableness, traits.neuroticism,
    baseline.openness, baseline.conscientiousness, baseline.extraversion,
    baseline.agreeableness, baseline.neuroticism,
    name ?? null, desc ?? null, now, version,
  );

  return getTraits(db)!;
}

export function updateTraitValues(
  db: Database.Database,
  traits: OceanTraits,
): void {
  const now = Date.now();
  db.prepare(`
    UPDATE persona_traits SET
      openness=?, conscientiousness=?, extraversion=?, agreeableness=?, neuroticism=?,
      updated_at=?, version=version+1
    WHERE id=1
  `).run(
    traits.openness, traits.conscientiousness, traits.extraversion,
    traits.agreeableness, traits.neuroticism, now,
  );
}

export function initTraitsIfNeeded(
  db: Database.Database,
  traits?: Partial<OceanTraits>,
  name?: string,
  desc?: string,
): PersonaTraits {
  const existing = getTraits(db);
  if (existing) return existing;

  const initial: OceanTraits = { ...DEFAULT_OCEAN, ...traits };
  return upsertTraits(db, initial, initial, name, desc);
}
