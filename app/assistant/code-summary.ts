// Missing prices must never be treated as 1.00 or advertised as verified totals.
export function resolvedTotal(rows: Array<{ odds: number | null }>): number | undefined {
  if (!rows.length || rows.some(row => row.odds == null || !Number.isFinite(row.odds) || row.odds <= 1)) return undefined;
  const total = rows.reduce((value, row) => value * row.odds!, 1);
  return Number.isFinite(total) ? total : undefined;
}

export function targetReached(target: number, total?: number, verified = false, partial = false) {
  return verified && !partial && total != null && Number.isFinite(total) && Math.abs(total - target) / target <= .05;
}

export function includedPicks<T extends { fixtureId: string }>(picks: T[], rows: Array<{ fixtureId: string; odds: number | null }>) {
  return rows.flatMap(row => {
    const pick = picks.find(item => item.fixtureId === row.fixtureId);
    return pick ? [{ ...pick, quotedOdds: row.odds }] : [];
  });
}
