// Wardrobe advisor (owner, 18.11; spec 2026-11-18-wardrobe-advisor-design.md): rates every item (agent
// judgement + the site's own counts), every shown look (harmony, one weaker piece with a better owned swap)
// and proposes new looks and capsules from owned items — proposals only, «Додати / Ні». An item worth
// replacing becomes an open purchase «замінить: …». Runs after changes and weekly; text only, never pictures.
import type { DB, Item, Job, Need, Season, Slots, Suggestion } from './schema.ts';
import { CATEGORIES, SEASONS, emptySlots } from './schema.ts';
import { newId, now } from './store.ts';
import { CATEGORY_UK, ownedItems } from './analysis.ts';
import { itemUsage, openSuggestions, siteLooks } from '../src/lib.ts';
import { hiddenLookIds, isCapsuleHidden, lookKeys, sameLookKeys } from '../src/rating.ts';

const str = { type: 'string' } as const;
const ids = { type: 'array', items: str } as const;
const SLOT_KEYS = ['top', 'layer', 'bottom', 'shoes', 'accessories'] as const;
const outfit = { name: str, top: ids, layer: ids, bottom: ids, shoes: ids, accessories: ids, why: str };
const outfitKeys = ['name', 'top', 'layer', 'bottom', 'shoes', 'accessories', 'why'];

export const ADVISE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'reason', 'items', 'looks', 'newLooks', 'newCapsules', 'newNeeds'],
  properties: {
    status: { type: 'string', enum: ['done', 'error'] },
    reason: str,
    items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'score', 'note', 'replace', 'replaceWith'], properties: { id: str, score: { type: 'number' }, note: str, replace: str, replaceWith: str } } },
    looks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'score', 'weakItem', 'swapTo', 'why'], properties: { id: str, score: { type: 'number' }, weakItem: str, swapTo: str, why: str } } },
    newLooks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['capsuleId', ...outfitKeys], properties: { capsuleId: str, ...outfit } } },
    newNeeds: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['capsuleId', 'title', 'category', 'why'], properties: { capsuleId: str, title: str, category: { type: 'string', enum: [...CATEGORIES] }, why: str } } },
    newCapsules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'season', 'why', 'looks'],
        properties: { name: str, season: { type: 'string', enum: [...SEASONS] }, why: str, looks: { type: 'array', items: { type: 'object', additionalProperties: false, required: outfitKeys, properties: outfit } } },
      },
    },
  },
};

type Outfit = { name: string; why: string } & Record<(typeof SLOT_KEYS)[number], string[]>;
export interface AdviseReply {
  status: string;
  reason: string;
  items: { id: string; score: number; note: string; replace: string; replaceWith: string }[];
  looks: { id: string; score: number; weakItem: string; swapTo: string; why: string }[];
  newLooks: (Outfit & { capsuleId: string })[];
  newCapsules: { name: string; season: string; why: string; looks: Outfit[] }[];
  newNeeds?: { capsuleId: string; title: string; category: string; why: string }[];
}

/** Items whose rating is missing or older than the item itself: the agent looks at them (with photos). */
export const itemsToRate = (db: DB) => ownedItems(db).filter((i) => !i.rating || i.rating.rev !== i.rev);

/** One advise job at a time in the queue; several changes in a row share it. */
export function queueAdvice(db: DB, reason: string): Job | null {
  if (!ownedItems(db).length) return null;
  if (db.jobs.some((j) => j.kind === 'advise' && j.state === 'queued')) return null;
  const j: Job = { id: newId('J'), kind: 'advise', lookVersion: 0, snapshot: { lookName: 'Порадник', slots: [], basePhotoIds: [], basePhotoPaths: [] }, instructions: reason, state: 'queued', origin: 'site', createdAt: now() };
  db.jobs.push(j);
  return j;
}

const WEEK = 7 * 24 * 60 * 60 * 1000;
/** The weekly review: due when no advice finished in the last 7 days and none is waiting. */
export function adviceDue(db: DB, at = Date.now()) {
  if (db.jobs.some((j) => j.kind === 'advise' && (j.state === 'queued' || j.state === 'running'))) return false;
  const last = Math.max(0, ...db.jobs.filter((j) => j.kind === 'advise' && j.state === 'done').map((j) => new Date(j.finishedAt ?? 0).getTime()));
  return at - last >= WEEK && ownedItems(db).length > 0;
}

const piecesLine = (db: DB, slots: Slots) =>
  SLOT_KEYS.flatMap((k) => slots[k].map((r) => (r.kind === 'item' ? `${k}:${r.id}` : `${k}:${r.kind === 'need' ? 'TO BUY ' + (db.needs.find((n) => n.id === r.id)?.title ?? r.id) : r.id}`))).join(', ');

export function advisePrompt(db: DB, job: Job, attached: string[]) {
  const items = ownedItems(db);
  const prefs = db.profile.preferences;
  const hidden = hiddenLookIds(db);
  const capsules = db.capsules.filter((c) => !isCapsuleHidden(db, c));
  const looks = siteLooks(db);
  const rejected = (db.suggestions ?? []).filter((s) => s.status === 'rejected').flatMap((s) => s.looks);
  const disliked = db.looks.filter((l) => hidden.has(l.id));
  const kept = items.filter((i) => i.rating?.kept).map((i) => i.id);
  const toRate = itemsToRate(db).map((i) => i.id);
  const openNeeds = db.needs.filter((n) => n.status === 'open').map((n) => `${n.title} (${n.category})`);
  return [
    'You are the Cap Fashion wardrobe advisor running unattended. Answer with JSON only (schema enforced). Write every text in Ukrainian, short.',
    'Owner preferences: comfortable, relaxed smart casual / casual for a remote-work lifestyle; calm, expensive-looking, minimal visible branding; no skinny trousers. Sportswear is fine for sporty looks but prefer cohesive, wearable outfits.',
    `Profile — comfort: ${prefs.comfort || '—'}; materials: ${prefs.materials || '—'}; fit: ${prefs.fit || '—'}; branding: ${prefs.branding || '—'}.`,
    job.instructions ? `What changed: ${job.instructions}` : '',
    '',
    `1. items — rate ONLY these ids now: ${toRate.join(', ') || 'none'}. score 0–10: style, how well it combines with the rest of the wardrobe, fit to the preferences and to the seasons of the capsules. note: one sentence why. replace: a reason ONLY when it is visible on the photo or clearly conflicts with the preferences (e.g. a large logo, does not fit any capsule style, visible wear); never invent condition, material or fit; otherwise empty. replaceWith: when replace is set, a short title of what to buy instead (e.g. «Темно-синє трикотажне поло»), else empty.`,
    attached.length ? `Photos of the items to rate are attached, named by item id (${attached.length} files).` : '',
    kept.length ? `The owner keeps these items — never suggest replacing them: ${kept.join(', ')}.` : '',
    '2. looks — for every look listed below: score 0–10 (harmony of colours, silhouette, formality, season). weakItem: an item id in that look that clearly weakens it, and swapTo: an owned item id for the same slot that is clearly better and not already in the look; both empty if nothing is clearly better. why: one sentence.',
    '3. newLooks — up to 3 new outfits from owned item ids only. Prefer items rated 7+ that have 0–1 shown looks (good piece, too few looks). capsuleId: the id of the listed capsule whose style and season fits, else empty. Each needs a bottom and shoes; at most one item per slot except accessories (max 2). why: which owned pieces it brings into use and why it works.',
    `5. newNeeds — at most 2: a piece to BUY when a listed capsule clearly lacks something for its style and season (e.g. no warm layer, no fitting shoes) and no owned item can fill it. capsuleId, title (short Ukrainian name of the piece), category (${CATEGORIES.join(' | ')}), why (one sentence). Never repeat the open purchases listed below. Usually empty.`,
    '4. newCapsules — at most 1, only when 3 or more strong outfits of one style and season are not covered by any listed capsule: a name, season (all | warm | transitional | cold), why and 3–5 looks (same rules). Usually empty.',
    'Same-look rule (the owner\'s): two outfits are the SAME look when identical or different by only one piece. Every new outfit must be a different look from each other, from every listed look and from every rejected outfit.',
    'Return status "error" only if the wardrobe cannot be read.',
    '',
    'Capsules (id | name | season | kind):',
    capsules.map((c) => `${c.id} | ${c.name} | ${c.season} | ${c.kind ?? 'capsule'}`).join('\n'),
    '',
    'Looks shown on the site (id | capsule | name | pieces):',
    looks.map((l) => `${l.id} | ${l.capsuleId ?? '—'} | ${l.name}${l.favorite ? ' | LIKED' : ''} | ${piecesLine(db, l.slots)}`).join('\n'),
    disliked.length ? `\nLooks the owner disliked (avoid their direction):\n${disliked.map((l) => `- ${piecesLine(db, l.slots)}`).join('\n')}` : '',
    rejected.length ? `\nOutfits the owner rejected as suggestions (never again, nothing within one piece):\n${rejected.map((o) => `- ${piecesLine(db, o.slots)}`).join('\n')}` : '',
    '',
    openNeeds.length ? `Open purchases (already planned, do not repeat): ${openNeeds.join('; ')}` : '',
    '',
    'Wardrobe (id | category | title | details | usage):',
    items
      .map((i) => {
        const u = itemUsage(db, i.id);
        const facts = [i.color, i.brand, i.fit, i.size].filter(Boolean).join(', ');
        return `${i.id} | ${CATEGORY_UK[i.category]} | ${i.title}${facts ? ` | ${facts}` : ''} | looks ${u.looks}, complete ${u.complete}, liked ${u.liked}, capsules ${u.capsules}${i.rating && i.rating.rev === i.rev ? ` | rated ${i.rating.score}` : ''}`;
      })
      .join('\n'),
  ]
    .filter((x) => x !== '')
    .join('\n');
}

const clampScore = (n: unknown) => Math.max(0, Math.min(10, Math.round(Number(n) || 0)));
const text = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);

function slotsFrom(o: Outfit, owned: Set<string>): Slots | null {
  const slots = emptySlots();
  for (const k of SLOT_KEYS) slots[k] = [...new Set((o[k] ?? []).filter((id) => owned.has(id)))].slice(0, k === 'accessories' ? 2 : 1).map((id) => ({ kind: 'item' as const, id }));
  return slots.bottom.length && slots.shoes.length ? slots : null;
}

/** Saves the advisor's answer: ratings, look advice, new proposals (older open ones are replaced), replacement purchases. */
export function applyAdvice(db: DB, job: Job, reply: AdviseReply) {
  const at = now();
  const owned = new Map(ownedItems(db).map((i) => [i.id, i] as const));
  let rated = 0;
  let replaced = 0;
  for (const r of reply.items ?? []) {
    const item = owned.get(r.id);
    if (!item) continue;
    const replace = item.rating?.kept ? '' : text(r.replace, 200);
    item.rating = { score: clampScore(r.score), note: text(r.note, 200), replace: replace || undefined, replaceWith: replace ? text(r.replaceWith, 80) || undefined : undefined, rev: item.rev, at, kept: item.rating?.kept };
    rated += 1;
    if (replace && item.rating.replaceWith && !db.needs.some((n) => n.replaces === item.id && n.status === 'open')) {
      replaced += 1;
      db.needs.push(replacementNeed(item, replace, item.rating.replaceWith, at));
    }
  }
  const shown = new Map(siteLooks(db).map((l) => [l.id, l] as const));
  for (const r of reply.looks ?? []) {
    const look = shown.get(r.id);
    if (!look) continue;
    const rejected = look.advice?.rejected ?? [];
    const slot = SLOT_KEYS.find((k) => look.slots[k].some((x) => x.kind === 'item' && x.id === r.weakItem));
    const inLook = Object.values(look.slots).flat().some((x) => x.kind === 'item' && x.id === r.swapTo);
    const swap = slot && owned.has(r.swapTo) && !inLook && !rejected.includes(`${r.weakItem}>${r.swapTo}`) ? { from: r.weakItem, to: r.swapTo } : undefined;
    look.advice = { score: clampScore(r.score), why: text(r.why, 200), version: look.version, swap, rejected: rejected.length ? rejected : undefined };
  }
  // New proposals replace the previous open ones; accepted and rejected ones stay as the owner's record.
  const keep = (db.suggestions ?? []).filter((s) => s.status !== 'open');
  const taken = [...db.looks.map(lookKeys), ...keep.flatMap((s) => s.looks.map(lookKeys))].filter((s) => s.size >= 2);
  const ownedIds = new Set(owned.keys());
  const fresh: Suggestion[] = [];
  const take = (o: Outfit) => {
    const slots = slotsFrom(o, ownedIds);
    if (!slots) return null;
    const set = lookKeys({ slots });
    if (taken.some((t) => sameLookKeys(set, t))) return null;
    taken.push(set);
    return { name: text(o.name, 80) || 'Образ', why: text(o.why, 240), slots };
  };
  for (const o of (reply.newLooks ?? []).slice(0, 3)) {
    const look = take(o);
    if (!look) continue;
    const capsuleId = db.capsules.some((c) => c.id === o.capsuleId) ? o.capsuleId : null;
    fresh.push({ id: newId('A'), kind: 'look', status: 'open', name: look.name, why: look.why, capsuleId, looks: [look], jobId: job.id, createdAt: at });
  }
  for (const c of (reply.newCapsules ?? []).slice(0, 1)) {
    const looks = (c.looks ?? []).slice(0, 5).map(take).filter((l): l is NonNullable<typeof l> => Boolean(l));
    if (looks.length < 2) continue;
    const season = ((SEASONS as readonly string[]).includes(c.season) ? c.season : 'all') as Season;
    fresh.push({ id: newId('A'), kind: 'capsule', status: 'open', name: text(c.name, 80) || 'Нова капсула', why: text(c.why, 240), season, looks, jobId: job.id, createdAt: at });
  }
  db.suggestions = [...keep, ...fresh];
  // What a capsule lacks becomes a purchase «Для капсули: …» — at most three such open at a time, never a repeat.
  let gaps = 0;
  const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  for (const g of (reply.newNeeds ?? []).slice(0, 2)) {
    const capsule = db.capsules.find((c) => c.id === g.capsuleId);
    const category = (CATEGORIES as readonly string[]).includes(g.category) ? (g.category as Need['category']) : null;
    const title = text(g.title, 80);
    if (!capsule || !category || !title) continue;
    if (db.needs.filter((n) => n.status === 'open' && n.forCapsule).length >= 3) break;
    if (db.needs.some((n) => n.status === 'open' && norm(n.title) === norm(title))) continue;
    db.needs.push({ id: newId('N'), rev: 1, title, category, priority: 'optional', description: '', why: text(g.why, 240), fitCheck: '', status: 'open', origin: 'agent', forCapsule: capsule.id, sourceNote: `Порадник ${at.slice(0, 10)}: бракує в капсулі «${capsule.name}»`, createdAt: at, updatedAt: at });
    gaps += 1;
  }
  const parts = [`Оцінено речей: ${rated}`, fresh.length ? `пропозицій: ${fresh.length}` : '', replaced ? `замінити: ${replaced}` : '', gaps ? `для капсул: ${gaps}` : ''].filter(Boolean);
  return parts.join(' · ');
}

function replacementNeed(item: Item, why: string, title: string, at: string): Need {
  return { id: newId('N'), rev: 1, title, category: item.category, priority: 'optional', description: '', why, fitCheck: '', status: 'open', origin: 'agent', replaces: item.id, sourceNote: `Порадник ${at.slice(0, 10)}: замінить «${item.title}»`, createdAt: at, updatedAt: at };
}

/** «Додати»: a look goes into its capsule (or stands alone), a capsule is created with its looks. */
export function acceptSuggestion(db: DB, s: Suggestion) {
  const at = now();
  const make = (l: Suggestion['looks'][number], capsuleId: string | null) => {
    const look = { id: newId('L'), rev: 1, capsuleId, name: l.name, note: l.why, slots: l.slots, version: 1, versions: [{ version: 1, slots: l.slots, at }], favorite: false, origin: 'agent' as const, sourceNote: `Порадник (${s.jobId}), додано власником ${at.slice(0, 10)}`, createdAt: at, updatedAt: at };
    db.looks.push(look);
    return look;
  };
  let target: string;
  if (s.kind === 'capsule') {
    const id = newId('C');
    const looks = s.looks.map((l) => make(l, id));
    db.capsules.push({ id, rev: 1, kind: 'capsule', name: s.name, season: s.season ?? 'all', description: s.why, situations: [], favorite: false, lookIds: looks.map((l) => l.id), origin: 'agent', sourceNote: `Порадник, додано власником ${at.slice(0, 10)}`, createdAt: at, updatedAt: at });
    target = `/capsules/${id}`;
  } else {
    const capsule = s.capsuleId ? db.capsules.find((c) => c.id === s.capsuleId) : undefined;
    const look = make(s.looks[0], capsule?.id ?? null);
    if (capsule) capsule.lookIds.push(look.id);
    target = `/looks/${look.id}`;
  }
  s.status = 'accepted';
  s.decidedAt = at;
  return target;
}

export { itemUsage, openSuggestions };
