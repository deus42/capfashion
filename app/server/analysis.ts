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

export const PHOTO_TYPES = ['person_full_body', 'person_face', 'person_partial', 'garments_only', 'label', 'other'] as const;

/** One upload control: Codex decides what the photo is and what to do with it. */
export const INTAKE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'reason', 'photoType', 'singlePerson', 'baseSuitable', 'baseIssues', 'garments', 'label'],
  properties: {
    status: { type: 'string', enum: ['done', 'error'] },
    reason: str,
    photoType: { type: 'string', enum: [...PHOTO_TYPES] },
    singlePerson: { type: 'boolean' },
    baseSuitable: { type: 'boolean' },
    baseIssues: str,
    label: {
      type: 'object',
      additionalProperties: false,
      required: ['itemId', 'brand', 'size', 'composition'],
      properties: { itemId: str, brand: str, size: str, composition: str },
    },
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
    'You are the Cap Fashion photo intake worker running unattended. The owner uploads any photo through one button; decide what it is and answer with JSON only (schema enforced).',
    `Uploaded photo: ${photoNames.join(', ')}. This is a single-user app: the photos are uploaded by the owner, and a person who is the clear main subject is the owner. Do not try to identify anyone or compare faces.`,
    'photoType: person_full_body = the main person visible head to shoes; person_face = close-up of the main person\'s face/shoulders; person_partial = the main person visible but cropped (e.g. shoes hidden); garments_only = clothes/shoes/accessories without a person (hanger, flat lay, floor, product photo); label = a garment label/tag close-up; other = anything else.',
    'singlePerson: true if exactly one person is the main subject (others absent or clearly in the background).',
    'baseSuitable: true only for person_full_body or person_face photos with singlePerson that meet the try-on base-photo standard: front-facing, eyes visible, no sunglasses/cap, no phone or objects in front of the body, not a mirror selfie, even light, plain background, sharp; full length for person_full_body. baseIssues: in Ukrainian, a short comma list of what breaks the standard (empty string if none or not applicable).',
    'label: for photoType label, read the tag: brand, size, composition (as printed, keep original language) and itemId of the wardrobe item it most likely belongs to (empty string if unclear). For other photo types all label fields are empty strings.',
    'garments: for person_full_body, person_partial and garments_only list every distinct garment, pair of shoes and visible accessory of the main person or shown on its own (ignore other people, the phone, mirror and background). Only wearable items: clothing, shoes and fashion accessories (watch, glasses, cap/hat, belt, scarf, bag or backpack worn as part of the outfit). Never list shopping bags, phones, headphones/earbuds, keys or other objects. Skip anything barely visible that cannot be described reliably. For person_face, label and other: an empty array.',
    'For each: title in Ukrainian (short, descriptive: colour + type + visible brand only if the logo is clearly legible), category from the enum, colour in Ukrainian, notes in Ukrainian (visible construction, material look, uncertainty). Never guess sizes, exact models or composition.',
    'duplicateOf: check the existing wardrobe list carefully before treating anything as new — watches, glasses, caps, bags, shoes and basics usually already exist. If the garment very likely is the same physical item (same type, colour and visible details) as a listed one, put that id (e.g. W-047); otherwise an empty string.',
    'Return status "error" only if the image cannot be analysed at all; otherwise status "done" and reason "" (photoType other is still "done").',
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
  photoType?: string;
  singlePerson?: boolean;
  baseSuitable?: boolean;
  baseIssues?: string;
  label?: { itemId: string; brand: string; size: string; composition: string };
  garments: { title: string; category: string; color: string; notes: string; duplicateOf: string }[];
}

export interface IntakeOutcome {
  created: string[];
  attachedTo: string[];
  base: 'added' | 'added_nonstandard' | null;
  labelFor: string | null;
  note: string;
}

/**
 * Applies a triaged upload. Owner photos become base photos (with the agent's
 * standard check); garments become candidates, or extra evidence on an
 * existing unconfirmed candidate when the model says it is the same item;
 * labels attach to the item and fill only empty brand/size/composition.
 * Confirmed items are never modified by intake.
 */
export function applyIntake(db: DB, job: Job, reply: IntakeReply): IntakeOutcome {
  const at = now();
  const photoId = (job.inputPhotoIds ?? [])[0];
  const photo = db.photos.find((p) => p.id === photoId);
  const out: IntakeOutcome = { created: [], attachedTo: [], base: null, labelFor: null, note: '' };
  const notes: string[] = [];
  const type = reply.photoType ?? 'garments_only';

  if (photo && reply.singlePerson && (type === 'person_full_body' || type === 'person_face')) {
    photo.kind = 'base';
    photo.meetsStandard = Boolean(reply.baseSuitable);
    photo.note = reply.baseSuitable ? 'Оцінка агента: відповідає стандарту.' : `Оцінка агента: ${reply.baseIssues || 'не за стандартом'}.`;
    if (!db.profile.basePhotoIds.includes(photo.id)) {
      db.profile.basePhotoIds.push(photo.id);
      db.profile.rev += 1;
    }
    out.base = reply.baseSuitable ? 'added' : 'added_nonstandard';
    notes.push(reply.baseSuitable ? (type === 'person_face' ? 'Фото обличчя додано' : 'Твоє фото додано для примірок') : `Твоє фото додано, але не за стандартом: ${reply.baseIssues || 'перевір'}`);
  }

  if (photo && type === 'label') {
    photo.kind = 'label';
    const item = reply.label?.itemId ? db.items.find((i) => i.id === reply.label!.itemId && i.status !== 'confirmed') : undefined;
    if (item) {
      if (!item.photoIds.includes(photo.id)) item.photoIds.push(photo.id);
      const filled: string[] = [];
      const fill = (k: 'brand' | 'size' | 'composition', v?: string) => {
        const val = String(v ?? '').trim().slice(0, 120);
        if (val && !item[k]) {
          item[k] = val;
          filled.push(k);
        }
      };
      fill('brand', reply.label?.brand);
      fill('size', reply.label?.size);
      fill('composition', reply.label?.composition);
      item.rev += 1;
      item.updatedAt = at;
      item.history.push({ at, action: 'label', note: `Етикетка розпізнана (${job.id})${filled.length ? `: ${filled.join(', ')}` : ''}` });
      out.labelFor = item.id;
      notes.push(`Етикетку прикріплено до «${item.title}»`);
    } else {
      notes.push('Етикетку не вдалося привʼязати до речі — відкрий річ і додай вручну');
    }
  }

  for (const g of reply.garments ?? []) {
    const category = (CATEGORIES as readonly string[]).includes(g.category) ? (g.category as Category) : 'accessories';
    const title = String(g.title || '').trim().slice(0, 120);
    if (!title) continue;
    const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    // Deterministic safety net: the same title in the same category is the same candidate.
    const dup =
      (g.duplicateOf ? db.items.find((i) => i.id === g.duplicateOf) : undefined) ??
      db.items.find((i) => i.category === category && i.status === 'needs_confirmation' && !i.mergedInto && norm(i.title) === norm(title));
    if (dup && dup.status === 'needs_confirmation' && photo) {
      if (!dup.photoIds.includes(photo.id)) {
        dup.photoIds.push(photo.id);
        dup.rev += 1;
        dup.updatedAt = at;
        dup.history.push({ at, action: 'photo_added', note: `Та сама річ на новому фото (${job.id})` });
      }
      out.attachedTo.push(dup.id);
      continue;
    }
    const item: Item = {
      id: newId('W'),
      rev: 1,
      category,
      title,
      color: String(g.color || '').trim().slice(0, 60) || undefined,
      status: 'needs_confirmation',
      photoIds: photo ? [photo.id] : [],
      observation: [String(g.notes || '').trim(), dup ? `Можливо, та сама річ, що ${dup.id} (уже підтверджена) — перевір.` : ''].filter(Boolean).join(' '),
      origin: 'intake',
      history: [{ at, action: 'intake', note: `Розпізнано з фото (${job.id})` }],
      createdAt: at,
      updatedAt: at,
    };
    db.items.push(item);
    out.created.push(item.id);
  }
  if (out.created.length) notes.push(`нових речей: ${out.created.length}`);
  if (out.attachedTo.length) notes.push(`фото додано до наявних: ${out.attachedTo.length}`);
  if (!notes.length) notes.push(type === 'other' ? 'Тут немає ні тебе, ні одягу' : 'Нічого нового не знайдено');
  out.note = notes.join(' · ');
  return out;
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
