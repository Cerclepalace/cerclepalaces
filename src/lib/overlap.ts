// Sélection et vérification anti-chevauchement des segments.

export type TimeRange = { start: number; end: number; slot?: number };

export type OverlapIssue<T extends TimeRange> = {
  message: string;
  prev: T;
  curr: T;
};

/**
 * Garde les meilleurs moments sans chevauchement.
 * L'ordre d'entrée fait foi (meilleur score en premier) ; on rejette tout
 * candidat qui empiète sur un segment déjà retenu.
 */
export function selectNonOverlappingMoments<T extends TimeRange & { score?: number }>(
  candidates: T[],
  opts: { gapSec?: number; max?: number } = {},
): T[] {
  const gap = opts.gapSec ?? 0.5;
  const ranked = [...candidates].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const kept: T[] = [];
  for (const c of ranked) {
    if (!(c.end > c.start)) continue;
    const clash = kept.some((k) => c.start < k.end + gap && k.start < c.end + gap);
    if (clash) continue;
    kept.push(c);
    if (opts.max && kept.length >= opts.max) break;
  }
  return kept.sort((a, b) => a.start - b.start);
}

/** Vérification post-traitement : s'assure qu'aucun segment ne se chevauche. */
export function verifyNoOverlap<T extends TimeRange>(
  selectedMoments: T[],
): { valid: boolean; issues: Array<OverlapIssue<T>> } {
  const sorted = [...selectedMoments].sort((a, b) => a.start - b.start);
  const issues: Array<OverlapIssue<T>> = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.start < prev.end) {
      issues.push({
        message: `Chevauchement détecté entre slot ${prev.slot ?? i - 1} (fin ${prev.end.toFixed(1)}s) et slot ${curr.slot ?? i} (début ${curr.start.toFixed(1)}s)`,
        prev,
        curr,
      });
    }
  }

  if (issues.length > 0) {
    console.error("⚠️ VÉRIFICATION ÉCHOUÉE :", issues);
    return { valid: false, issues };
  }

  console.log(`✅ Vérification OK : aucun chevauchement, ${sorted.length} segments valides`);
  return { valid: true, issues: [] };
}
