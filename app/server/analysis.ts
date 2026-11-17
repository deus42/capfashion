// Text/vision analysis jobs (no image output): photo intake and the outfit
// analyzer. Codex answers with JSON constrained by --output-schema; the result
// is validated here before anything is written.
import type { Category, DB, Item, Job, Look, Season, SlotKey } from './schema.ts';
import { CATEGORIES, SEASONS, SLOT_KEYS, emptySlots } from './schema.ts';
import { newId, now } from './store.ts';

export const CATEGORY_UK: Record<Category, string> = {
  outerwear: 'верхній одяг', knitwear: 'худі й трикотаж', shirts: 'сорочки й поло', tees: 'футболки',
  trousers: 'штани', shorts: 'шорти', shoes: 'взуття', accessories: 'аксесуари',
};

const str = { type: 'string' } as const;
const ids = { type: 'array', items: { type: 'string' } } as const;

export const INTAKE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'reason', 'garments'],
  properties: {
    status: { type: 'string', enum: ['done', 'error'] },
    reason: str,
    garments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'category', 'color', 'notes', 'duplicateOf'],
        properties: { title: str, category: { type: 'string', enum: [...CATEGORIES] }, color: str, notes: str, duplicateOf: str },
      },
    },
  },
};

export const ANALYZE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'reason', 'name', 'description', 'looks'],
  properties: {
    status: { type: 'string', enum: ['done', 'error'] },
    reason: str,
    name: str,
    description: str,
    looks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'occasion', 'season', 'top', 'layer', 'bottom', 'shoes', 'accessories', 'why'],
        properties: { name: str, occasion: str, season: { type: 'string', enum: [...SEASONS] }, top: ids, layer: ids, bottom: ids, shoes: ids, accessories: ids, why: str },
      },
    },
  },
};

function wardrobeLines(db: DB, items: Item[]) {
  return items
    .map((i) => {
      const facts = [i.color, i.brand, i.fit, i.size].filter(Boolean).join(', ');
      return `${i.id} | ${CATEGORY_UK[i.category]} | ${i.title}${facts ? ` | ${facts}` : ''} | ${i.status === 'confirmed' ? 'confirmed by owner' : 'candidate'}${i.observation ? ` | ${i.observation}` : ''}`;
    })
    .join('\n');
}

export function ownedItems(db: DB) {
  return db.items.filter((i) => i.status !== 'inactive' && !i.mergedInto);
}

export function intakePrompt(db: DB, job: Job, photoNames: string[]) {
  return [
    'You are the Cap Fashion wardrobe intake worker running unattended. Analyse the attached photo(s) and answer with JSON only (schema enforced).',
    `Photos: ${photoNames.join(', ')}. They were uploaded by the owner to add clothes to his wardrobe: either garments laid out / on a hanger, or the owner wearing an outfit.`,
    'List every distinct garment, pair of shoes and visible accessory that belongs to the owner (the main person, or the items shown on their own). Ignore other people, the phone, mirror and background.',
    'For each: title in Ukrainian (short, descriptive: colour + type + visible brand only if the logo is clearly legible), category from the enum, colour in Ukrainian, notes in Ukrainian (visible construction, material look, uncertainty). Never guess sizes, exact models or composition.',
    'duplicateOf: if the garment very likely is the same physical item as one in the existing wardrobe list below, put that id (e.g. W-023); otherwise an empty string. Be conservative.',
    'If the photo shows no clothing or cannot be analysed, return status "error" with the reason and an empty garments array; otherwise status "done" and reason "".',
    job.instructions ? `Owner note: ${job.instructions}` : '',
    '',
    'Existing wardrobe:',
    wardrobeLines(db, ownedItems(db)),
  ]
    .filter(Boolean)
    .join('\n');
}

export function analyzePrompt(db: DB, job: Job, attached: string[]) {
  const items = ownedItems(db);
  return [
    'You are the Cap Fashion stylist running unattended. Build outfits ONLY from the owner\'s existing wardrobe listed below and answer with JSON only (schema enforced).',
    'Owner preferences: comfortable, relaxed smart casual / casual for a remote-work lifestyle; calm, expensive-looking, minimal visible branding; no skinny trousers. Sportswear is fine for sporty looks but prefer cohesive, wearable outfits.',
    `Profile notes: ${Object.values(db.profile.preferences).filter(Boolean).join(' ')}`,
    job.instructions ? `Request from the owner: ${job.instructions}` : 'Request: a balanced set of everyday outfits for the current season.',
    '',
    'Rules: use only ids from the list (exact strings). Each look needs a bottom and shoes; add a top unless the outer layer is worn closed; at most one item per slot except accessories (max 2). Do not repeat the same exact combination. Prefer items "confirmed by owner", but candidates are allowed. Produce 4 to 6 looks unless the owner asked otherwise.',
    'Write name, description, look names, occasion and why in Ukrainian, short (why: one sentence on colour/silhouette logic). season: all | warm | transitional | cold.',
    attached.length ? `Packshot images are attached as files named by item id (${attached.length} files) — use them to judge colours and styles.` : '',
    'If the wardrobe is not enough for a single sensible outfit, return status "error" with the reason.',
    '',
    'Wardrobe (id | category | title | details | status | notes):',
    wardrobeLines(db, items),
  ]
    .filter(Boolean)
    .join('\n');
}

interface IntakeReply {
  status: string;
  reason: string;
  garments: { title: string; category: string; color: string; notes: string; duplicateOf: string }[];
}

/** Creates wardrobe candidates from an intake reply; returns their ids. */
export function applyIntake(db: DB, job: Job, reply: IntakeReply): string[] {
  const at = now();
  const created: string[] = [];
  for (const g of reply.garments ?? []) {
    const category = (CATEGORIES as readonly string[]).includes(g.category) ? (g.category as Category) : 'accessories';
    const title = String(g.title || '').trim().slice(0, 120);
    if (!title) continue;
    const dup = g.duplicateOf && db.items.some((i) => i.id === g.duplicateOf) ? g.duplicateOf : '';
    const item: Item = {
      id: newId('W'),
      rev: 1,
      category,
      title,
      color: String(g.color || '').trim().slice(0, 60) || undefined,
      status: 'needs_confirmation',
      photoIds: [...(job.inputPhotoIds ?? [])],
      observation: [String(g.notes || '').trim(), dup ? `Можливо, та сама річ, що ${dup} — перевір і обʼєднай.` : ''].filter(Boolean).join(' '),
      origin: 'intake',
      history: [{ at, action: 'intake', note: `Розпізнано з фото (${job.id})` }],
      createdAt: at,
      updatedAt: at,
    };
    db.items.push(item);
    created.push(item.id);
  }
  return created;
}

interface AnalyzeReply {
  status: string;
  reason: string;
  name: string;
  description: string;
  looks: ({ name: string; occasion: string; season: string; why: string } & Record<SlotKey, string[]>)[];
}

/** Turns an analyzer reply into a selection of owned-only looks; returns the capsule id. */
export function applyAnalyze(db: DB, job: Job, reply: AnalyzeReply): string | null {
  const owned = new Set(ownedItems(db).map((i) => i.id));
  const at = now();
  const capsuleId = newId('C');
  const looks: Look[] = [];
  for (const l of reply.looks ?? []) {
    const slots = emptySlots();
    for (const k of SLOT_KEYS) {
      const limit = k === 'accessories' ? 2 : 1;
      slots[k] = [...new Set((l[k] ?? []).filter((id) => owned.has(id)))].slice(0, limit).map((id) => ({ kind: 'item' as const, id }));
    }
    if (!slots.bottom.length || !slots.shoes.length) continue;
    const key = JSON.stringify(slots);
    if (looks.some((x) => JSON.stringify(x.slots) === key)) continue;
    looks.push({
      id: newId('L'),
      rev: 1,
      capsuleId,
      name: String(l.name || 'Образ').slice(0, 80),
      note: [l.occasion, l.why].filter(Boolean).join(' — ').slice(0, 400),
      slots,
      version: 1,
      versions: [{ version: 1, slots, at }],
      favorite: false,
      origin: 'agent',
      sourceNote: `Аналізатор (${job.id}): лише наявні речі`,
      createdAt: at,
      updatedAt: at,
    });
  }
  if (!looks.length) return null;
  const seasons = new Set(reply.looks.map((l) => l.season).filter((s) => (SEASONS as readonly string[]).includes(s)));
  const season: Season = seasons.size === 1 ? ([...seasons][0] as Season) : 'all';
  db.looks.push(...looks);
  db.capsules.push({
    id: capsuleId,
    rev: 1,
    kind: 'selection',
    name: String(reply.name || 'Підбірка з моїх речей').slice(0, 80),
    season,
    description: String(reply.description || '').slice(0, 400),
    situations: [...new Set(reply.looks.map((l) => l.occasion).filter(Boolean))].slice(0, 6),
    favorite: false,
    lookIds: looks.map((l) => l.id),
    origin: 'agent',
    sourceNote: `Аналізатор образів, ${at.slice(0, 10)}${job.instructions ? ` — «${job.instructions}»` : ''}; лише наявні речі`,
    createdAt: at,
    updatedAt: at,
  });
  return capsuleId;
}
