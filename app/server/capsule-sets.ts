// Read-only view of every fashion capsule as a closed set (spec 2026-11-20-capsule-system-design.md, stage 1).
// `node app/server/capsule-sets.ts` prints the current sets — saved, or read from the looks — with their limits;
// `--json` prints the same as JSON. It never writes: the stylist proposes the cuts and the owner approves them.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DB, SlotRef } from './schema.ts';
import { CAPSULE_LIMITS, capsuleSet, pieceKey, type CapsulePiece, type PieceRole } from '../src/capsule-pieces.ts';
import { isCapsuleArchived, isCapsuleHidden } from '../src/rating.ts';

export interface CapsuleSetReport {
  id: string;
  name: string;
  periods: string[];
  saved: boolean;
  counts: { garments: number; shoes: number; accessories: number };
  limits: typeof CAPSULE_LIMITS;
  over: string[];
  owned: number;
  toBuy: number;
  combinations: number;
  pieces: { ref: SlotRef; title: string; role: PieceRole; looks: number; owned: boolean; base: boolean }[];
}

const title = (db: DB, r: SlotRef) =>
  (r.kind === 'item' ? db.items.find((i) => i.id === r.id)?.title : db.needs.find((n) => n.id === r.id)?.title) ?? r.id;

export function capsuleSetsReport(db: DB): { capsules: CapsuleSetReport[]; sharedGarments: { a: string; b: string; count: number }[] } {
  const capsules = db.capsules.filter((c) => c.kind !== 'selection' && !isCapsuleArchived(c) && !isCapsuleHidden(db, c));
  const reports = capsules.map((c): CapsuleSetReport => {
    const set = capsuleSet(db, c);
    const view = (p: CapsulePiece) => ({ ref: p.ref, title: title(db, p.ref), role: p.role, looks: p.looks, owned: p.owned, base: p.base });
    return {
      id: c.id,
      name: c.name,
      periods: c.periods ?? [],
      saved: set.saved,
      counts: set.counts,
      limits: CAPSULE_LIMITS,
      over: set.over,
      owned: set.pieces.filter((p) => p.owned).length,
      toBuy: set.pieces.filter((p) => !p.owned).length,
      combinations: set.combinations,
      pieces: set.pieces.map(view),
    };
  });
  const garments = new Map(reports.map((r) => [r.id, new Set(r.pieces.filter((p) => !['shoes', 'accessories'].includes(p.role)).map((p) => pieceKey(p.ref)))]));
  const sharedGarments: { a: string; b: string; count: number }[] = [];
  for (let i = 0; i < reports.length; i++) {
    for (let j = i + 1; j < reports.length; j++) {
      const a = garments.get(reports[i].id)!, b = garments.get(reports[j].id)!;
      const count = [...a].filter((k) => b.has(k)).length;
      if (count) sharedGarments.push({ a: reports[i].name, b: reports[j].name, count });
    }
  }
  return { capsules: reports, sharedGarments };
}

const GROUP_UK: Record<string, string> = { garments: 'одяг', shoes: 'взуття', accessories: 'аксесуари' };
const ROLE_UK: Record<PieceRole, string> ={ layer: 'Шар', top: 'Верх', bottom: 'Низ', shoes: 'Взуття', accessories: 'Аксесуари' };

export function formatReport(report: ReturnType<typeof capsuleSetsReport>): string {
  const lines: string[] = [];
  for (const c of report.capsules) {
    const over = c.over.length ? `  ПОНАД МЕЖУ: ${c.over.map((g) => GROUP_UK[g] ?? g).join(', ')}` : '';
    lines.push(`${c.name} (${c.periods.join(', ') || 'без періоду'}) — ${c.saved ? 'набір збережено' : 'набір з образів'}`);
    lines.push(`  одяг ${c.counts.garments}/${c.limits.garments} · взуття ${c.counts.shoes}/${c.limits.shoes} · аксесуари ${c.counts.accessories}/${c.limits.accessories} · свої ${c.owned}, докупити ${c.toBuy} · поєднань ${c.combinations}${over}`);
    for (const role of ['layer', 'top', 'bottom', 'shoes', 'accessories'] as PieceRole[]) {
      const ps = c.pieces.filter((p) => p.role === role);
      if (!ps.length) continue;
      lines.push(`  ${ROLE_UK[role]}: ${ps.map((p) => `${p.title}${p.owned ? '' : ' [докупити]'}${p.base ? ' [база]' : ''} ×${p.looks}`).join('; ')}`);
    }
  }
  for (const s of report.sharedGarments) lines.push(`Спільний одяг: ${s.a} і ${s.b} — ${s.count}`);
  return lines.join('\n');
}

if (import.meta.main) {
  const dataDir = process.env.CAPSULA_DATA_DIR || fileURLToPath(new URL('../../.local/app-data/', import.meta.url));
  try {
    const db: DB = JSON.parse(readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
    const report = capsuleSetsReport(db);
    console.log(process.argv.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report));
  } catch {
    console.error('Не вдалося прочитати локальний каталог.');
    process.exitCode = 1;
  }
}
