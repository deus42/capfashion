import fs from 'node:fs';
import path from 'node:path';
import type { Category, DB, Item, Look, Need, Photo, SlotKey, SlotRef } from './schema.ts';
import { SCHEMA_VERSION, emptySlots } from './schema.ts';

// Initial data built only from saved project sources: the 25 chat photos, the
// 47 candidate groups, the 14 November capsule/shopping notes and the first
// Urban Casual concept. Nothing here is a confirmed ownership or fit fact.

const SOURCE_DIR = 'assets/photos/chatgpt-2026-11-14';
const SOURCE_NOTE = 'Чат «Нагадай чорну пʼятницю», 14.11.2026; docs/capsules/2026-11-14.md';

const CATEGORY_MAP: Record<string, Category> = {
  'Верхній одяг': 'outerwear',
  'Худі й трикотаж': 'knitwear',
  'Сорочки й поло': 'shirts',
  Футболки: 'tees',
  Штани: 'trousers',
  Шорти: 'shorts',
  Взуття: 'shoes',
  Аксесуари: 'accessories',
};

const CONFIRMED_FACTS: Record<string, string> = {
  'W-001': 'Власник підтвердив у чаті, що підстібка з останнього фото належить зеленій куртці.',
  'W-002': 'Власник підтвердив у чаті підстібку зеленої куртки; відповідність фото звірити.',
  'W-023': 'Власник підтвердив у чаті, що має navy chinos; відповідність фото звірити.',
  'W-032': 'Власник підтвердив у чаті, що регулярно носить білі Adidas Stan Smith; фотозбіги звірити.',
};

interface CandidateFile {
  candidateGroups: { id: string; category: string; title: string; source_photos: string[]; observation_note: string }[];
  photoObservations: [string, string][];
}

type NeedSeed = Omit<Need, 'rev' | 'status' | 'createdAt' | 'updatedAt'>;

const NEEDS: NeedSeed[] = [
  { id: 'N-01', title: 'Бежеві / пісочні чіноси', category: 'trousers', priority: 'core', origin: 'source', description: 'Chinos straight або regular tapered, бежевий чи пісочний відтінок.', why: 'Друга база низу: світлий контраст до navy chinos, основа Mediterranean і Refined.', fitCheck: 'Не skinny; вільно в стегнах при присіданні; мінімальний залом над взуттям.', sourceNote: 'Пріоритет 1 у пізніх покупках' },
  { id: 'N-02', title: 'Світло-блакитна Oxford-сорочка', category: 'shirts', priority: 'core', origin: 'source', description: 'Oxford cloth button-down, світло-блакитна, м’яка casual тканина.', why: 'Головний верх Mediterranean Smart Casual; працює з закоченими рукавами й під светр.', fitCheck: 'Шов плеча на кінці плеча; не тягне на ґудзиках у грудях; довжина для носіння навипуск — до середини ширінки.', sourceNote: 'Пріоритет 2' },
  { id: 'N-03', title: 'Оливковий overshirt', category: 'outerwear', priority: 'core', origin: 'source', description: 'Щільний бавовняний overshirt, оливковий, дві накладні кишені, прямий низ.', why: 'Верхній шар Urban Casual поверх футболки.', fitCheck: 'Relaxed без зайвого об’єму; вільно поверх футболки чи тонкого светра; рукав до зап’ястя.', sourceNote: 'Пріоритет 3' },
  { id: 'N-04', title: 'Коричневі / taupe замшеві кеди', category: 'shoes', priority: 'core', origin: 'source', description: 'Мінімалістичні низькі кеди з замші, коричневі або taupe.', why: 'Спільне взуття для всіх трьох капсул; тепліша альтернатива білим Stan Smith.', fitCheck: 'Довжина стопи з запасом ~1 см; не тисне по ширині; замша рівна без плям.', sourceNote: 'Пріоритет 4' },
  { id: 'N-05', title: 'Гладкий коричневий шкіряний ремінь 32–35 мм', category: 'accessories', priority: 'core', origin: 'source', description: 'Матовий коричневий шкіряний ремінь, ширина 32–35 мм, проста пряжка.', why: 'Поєднує коричневе взуття з образом; теплий колір без точного збігу.', fitCheck: 'Застібається на середню дірку; ширина проходить у шльовки чінос.', sourceNote: 'Пріоритет 5' },
  { id: 'N-06', title: 'Трикотажне поло ivory / oatmeal / taupe', category: 'shirts', priority: 'core', origin: 'source', description: 'Фактурне трикотажне поло у світлому нейтральному кольорі.', why: 'Головний верх Refined Casual; дорожчий вигляд за звичайне піке-поло.', fitCheck: 'Облягає м’яко без натягу на животі; рукав до середини біцепса; довжина до пояса.', sourceNote: 'Пріоритет 6' },
  { id: 'N-07', title: 'Тонкий светр oatmeal / світло-сірий', category: 'knitwear', priority: 'core', origin: 'source', description: 'Тонкий светр з круглим вирізом, oatmeal або світло-сірий.', why: 'Шар для прохолодних днів: поверх Oxford або під overshirt.', fitCheck: 'Не стягує під пахвами; манжети тримають форму; довжина прикриває пояс.', sourceNote: 'Пріоритет 7' },
  { id: 'N-08', title: 'Плетений коричневий ремінь', category: 'accessories', priority: 'optional', origin: 'source', description: 'Плетений шкіряний ремінь коричневого кольору.', why: 'Легший літній варіант до Mediterranean.', fitCheck: 'Довжина з запасом на кілька отворів плетіння.', sourceNote: 'Необовʼязкове доповнення' },
  { id: 'N-09', title: 'Desert boots', category: 'shoes', priority: 'optional', origin: 'source', description: 'Замшеві черевики desert boots на легкій підошві.', why: 'Холодніша альтернатива замшевим кедам.', fitCheck: 'Пʼята не вискакує; простір для пальців; без натирання на згині.', sourceNote: 'Необовʼязкове доповнення' },
  { id: 'N-10', title: 'Молочна однотонна футболка', category: 'tees', priority: 'optional', origin: 'agent', description: 'Однотонна футболка кольору молока / off-white з щільної бавовни, без принтів.', why: 'Основа Urban Casual. Спершу звірити наявні білі футболки W-019/W-020 — можливо, купувати не треба.', fitCheck: 'Шов плеча на плечі; горловина не розтягнута; довжина до середини ширінки.', sourceNote: 'Пропозиція агента з оригінальної капсули' },
  { id: 'N-11', title: 'Біла / кремова Oxford-сорочка', category: 'shirts', priority: 'optional', origin: 'source', description: 'Oxford-сорочка білого або кремового кольору.', why: 'Classic Casual з наявними navy chinos.', fitCheck: 'Як у блакитної Oxford.', sourceNote: 'Пізніша варіація' },
  { id: 'N-12', title: 'Бежевий overshirt / chore jacket', category: 'outerwear', priority: 'optional', origin: 'source', description: 'Бежевий overshirt або chore jacket.', why: 'Layered Casual та Soft Autumn.', fitCheck: 'Вільно поверх светра; рукав не закриває долоню.', sourceNote: 'Пізніша варіація' },
  { id: 'N-13', title: 'Темно-синій overshirt', category: 'outerwear', priority: 'optional', origin: 'source', description: 'Темно-синій overshirt.', why: 'Navy & Sand з бежевими чіносами.', fitCheck: 'Як у оливкового overshirt.', sourceNote: 'Пізніша варіація' },
  { id: 'N-14', title: 'Темно-синє поло', category: 'shirts', priority: 'optional', origin: 'source', description: 'Темно-синє поло.', why: 'Polo Casual з бежевими чіносами.', fitCheck: 'Рукав до середини біцепса; не обтягує.', sourceNote: 'Пізніша варіація' },
  { id: 'N-15', title: 'Біла або світла смугаста сорочка', category: 'shirts', priority: 'optional', origin: 'source', description: 'Біла чи світла смугаста casual-сорочка.', why: 'Navy & Sand.', fitCheck: 'Як у Oxford-сорочки.', sourceNote: 'Пізніша варіація' },
];

const n = (id: string): SlotRef => ({ kind: 'need', id });
const it = (id: string): SlotRef => ({ kind: 'item', id });

interface LookSeed {
  id: string;
  name: string;
  origin: Look['origin'];
  note: string;
  slots: Partial<Record<SlotKey, SlotRef[]>>;
}

const CAPSULES: { id: string; name: string; season: DB['capsules'][number]['season']; description: string; situations: string[]; looks: LookSeed[] }[] = [
  {
    id: 'C-urban',
    name: 'Urban Casual',
    season: 'transitional',
    description: 'Спокійний міський casual: молочна футболка, оливковий overshirt, твої navy chinos і коричнева замша.',
    situations: ['Прогулянка містом', 'Кава / зустріч з друзями', 'Віддалена робота поза домом'],
    looks: [
      { id: 'L-urban-1', name: 'Urban Casual — оригінал', origin: 'source', note: 'Оригінальна капсула з чату. Штани — твої наявні navy chinos з їхнім реальним кроєм (рішення 17.11).', slots: { top: [n('N-10')], layer: [n('N-03')], bottom: [it('W-023')], shoes: [n('N-04')], accessories: [n('N-05')] } },
      { id: 'L-urban-2', name: 'Olive Casual', origin: 'source', note: 'Пізніша варіація з чату.', slots: { top: [n('N-10')], layer: [n('N-03')], bottom: [n('N-01')], shoes: [it('W-032')] } },
      { id: 'L-urban-3', name: 'Soft Autumn', origin: 'source', note: 'Пізніша варіація з чату.', slots: { top: [n('N-07')], layer: [n('N-12')], bottom: [it('W-023')], shoes: [n('N-04')], accessories: [n('N-05')] } },
      { id: 'L-urban-4', name: 'Navy & Sand', origin: 'source', note: 'Пізніша варіація з чату.', slots: { top: [n('N-15')], layer: [n('N-13')], bottom: [n('N-01')], shoes: [n('N-04')], accessories: [n('N-05')] } },
    ],
  },
  {
    id: 'C-med',
    name: 'Mediterranean Smart Casual',
    season: 'warm',
    description: 'Світлий теплий smart casual: блакитна Oxford із закоченими рукавами, пісочні чіноси, замша й плетений ремінь.',
    situations: ['Вечеря на набережній', 'Подорож', 'Тепла погода'],
    looks: [
      { id: 'L-med-1', name: 'Mediterranean — оригінал', origin: 'source', note: 'Оригінальна капсула з чату.', slots: { top: [n('N-02')], bottom: [n('N-01')], shoes: [n('N-04')], accessories: [n('N-08')] } },
      { id: 'L-med-2', name: 'Oxford + светр', origin: 'source', note: 'Опційний oatmeal-светр з оригінальної капсули.', slots: { top: [n('N-02')], layer: [n('N-07')], bottom: [n('N-01')], shoes: [n('N-09')], accessories: [n('N-08')] } },
      { id: 'L-med-3', name: 'Classic Casual', origin: 'source', note: 'Пізніша варіація з чату.', slots: { top: [n('N-11')], bottom: [it('W-023')], shoes: [n('N-04')], accessories: [n('N-05')] } },
      { id: 'L-med-4', name: 'Summer Smart Casual', origin: 'source', note: 'Приклад після фото: зелене поло, бежеві чіноси, замшеві кеди.', slots: { top: [it('W-016')], bottom: [n('N-01')], shoes: [n('N-04')] } },
      { id: 'L-med-5', name: 'Layered Casual', origin: 'source', note: 'Пізніша варіація з чату.', slots: { top: [n('N-02')], layer: [n('N-12')], bottom: [it('W-023')], shoes: [n('N-04')], accessories: [n('N-05')] } },
    ],
  },
  {
    id: 'C-refined',
    name: 'Refined Casual',
    season: 'all',
    description: 'Найспокійніший і найдорожчий на вигляд варіант: фактурне трикотажне поло, чіноси, коричнева замша.',
    situations: ['Вечеря', 'Зустріч, де потрібно виглядати зібрано', 'Щодня без зусиль'],
    looks: [
      { id: 'L-ref-1', name: 'Refined — navy', origin: 'source', note: 'Оригінальна капсула з чату (navy chinos).', slots: { top: [n('N-06')], bottom: [it('W-023')], shoes: [n('N-04')], accessories: [n('N-05')] } },
      { id: 'L-ref-2', name: 'Refined — beige', origin: 'source', note: 'Оригінальна капсула з чату (beige chinos).', slots: { top: [n('N-06')], bottom: [n('N-01')], shoes: [n('N-04')], accessories: [n('N-08')] } },
      { id: 'L-ref-3', name: 'Polo Casual', origin: 'source', note: 'Пізніша варіація з чату.', slots: { top: [n('N-14')], bottom: [n('N-01')], shoes: [n('N-04')] } },
      { id: 'L-ref-4', name: 'Refined — щоденний', origin: 'agent', note: 'Пропозиція агента: трикотажне поло з наявними navy chinos і Stan Smith.', slots: { top: [n('N-06')], bottom: [it('W-023')], shoes: [it('W-032')] } },
    ],
  },
];

export function buildSeed(projectRoot: string, dataDir: string): DB {
  const at = new Date().toISOString();
  const candidates = JSON.parse(fs.readFileSync(path.join(projectRoot, '.local/wardrobe-candidates.json'), 'utf8')) as CandidateFile;
  const observations = new Map(candidates.photoObservations);
  const sourceFiles = fs.readdirSync(path.join(projectRoot, SOURCE_DIR)).filter((f) => /\.jpe?g$/i.test(f)).sort();

  const photos: Photo[] = sourceFiles.map((f) => ({
    id: `P-${f.replace(/\.[^.]+$/, '')}`,
    kind: 'source',
    path: `${SOURCE_DIR}/${f}`,
    originalName: f,
    source: 'chat-2026-11-14',
    observation: observations.get(f),
    meetsStandard: false,
    createdAt: at,
  }));
  const photoIdByName = new Map(photos.map((p) => [p.originalName, p.id]));

  const items: Item[] = candidates.candidateGroups.map((g) => ({
    id: g.id,
    rev: 1,
    category: CATEGORY_MAP[g.category] ?? 'accessories',
    title: g.title,
    status: 'needs_confirmation',
    photoIds: g.source_photos.map((f) => photoIdByName.get(f)).filter((x): x is string => Boolean(x)),
    observation: g.observation_note,
    confirmedFact: CONFIRMED_FACTS[g.id],
    origin: 'candidate',
    history: [{ at, action: 'imported', note: 'Кандидат із візуального огляду 25 фото (15–16.11.2026)' }],
    createdAt: at,
    updatedAt: at,
  }));

  const needs: Need[] = NEEDS.map((s) => ({ ...s, rev: 1, status: 'open', createdAt: at, updatedAt: at }));

  const looks: Look[] = [];
  const capsules = CAPSULES.map((c) => {
    for (const l of c.looks) {
      const slots = { ...emptySlots(), ...l.slots };
      looks.push({ id: l.id, rev: 1, capsuleId: c.id, name: l.name, note: l.note, slots, version: 1, versions: [{ version: 1, slots, at }], favorite: false, origin: l.origin, sourceNote: SOURCE_NOTE, createdAt: at, updatedAt: at });
    }
    return { id: c.id, rev: 1, name: c.name, season: c.season, description: c.description, situations: c.situations, favorite: false, lookIds: c.looks.map((l) => l.id), origin: 'source' as const, sourceNote: SOURCE_NOTE, createdAt: at, updatedAt: at };
  });

  const db: DB = {
    schemaVersion: SCHEMA_VERSION,
    revision: 1,
    updatedAt: at,
    photos,
    items,
    needs,
    products: [],
    looks,
    capsules,
    jobs: [],
    results: [],
    comparisons: [],
    profile: {
      rev: 1,
      basePhotoIds: [],
      measurements: { height: { value: null }, chest: { value: null }, waist: { value: null }, hips: { value: null }, shoulders: { value: null }, sleeve: { value: null }, inseam: { value: null }, foot: { value: null } },
      knownSizes: [],
      preferences: {
        comfort: 'Комфорт понад усе; relaxed smart casual для віддаленої роботи.',
        materials: 'Якісні матеріали, хороша бавовна, натуральна основа; якісні суміші допустимі.',
        fit: 'Без skinny-штанів; мінімальний залом над взуттям; overshirt relaxed без зайвого обʼєму.',
        branding: 'Мінімальне помітне брендування; спокійний дорогий на вигляд стиль.',
      },
    },
    settings: { codexModel: 'gpt-6.1-sol', reasoningEffort: 'medium', tailscaleLogin: '' },
  };

  importFirstConcept(db, projectRoot, dataDir, at);
  return db;
}

/** Brings the 16 November Urban Casual concept in as a result awaiting owner review. */
function importFirstConcept(db: DB, projectRoot: string, dataDir: string, at: string) {
  const png = path.join(projectRoot, 'output/prototypes/2026-11-16-urban-casual-v1.png');
  const meta = path.join(projectRoot, 'output/prototypes/2026-11-16-urban-casual-v1.json');
  if (!fs.existsSync(png) || !fs.existsSync(meta)) return;
  const info = JSON.parse(fs.readFileSync(meta, 'utf8')) as { prompt: string; sourcePhotos: string[]; tool: string; modelId: string; createdAt: string };
  const rendersDir = path.join(dataDir, 'media', 'renders');
  fs.mkdirSync(rendersDir, { recursive: true });
  const target = path.join(rendersDir, 'J-import-urban-v1.png');
  if (!fs.existsSync(target)) fs.copyFileSync(png, target);
  const look = db.looks.find((l) => l.id === 'L-urban-1')!;
  const basePaths = info.sourcePhotos.map((f) => `${SOURCE_DIR}/${f}`);
  db.jobs.push({
    id: 'J-import-urban-v1',
    lookId: look.id,
    lookVersion: 1,
    snapshot: { lookName: look.name, slots: [], basePhotoIds: info.sourcePhotos.map((f) => `P-${f.replace(/\.[^.]+$/, '')}`), basePhotoPaths: basePaths },
    instructions: 'Імпорт першого концепту з output/prototypes (16.11.2026).',
    state: 'done',
    resultId: 'R-import-urban-v1',
    origin: 'import',
    createdAt: `${info.createdAt}T00:00:00.000Z`,
    finishedAt: `${info.createdAt}T00:00:00.000Z`,
  });
  db.results.push({
    id: 'R-import-urban-v1',
    jobId: 'J-import-urban-v1',
    lookId: look.id,
    lookVersion: 1,
    imagePath: path.relative(projectRoot, target),
    tool: info.tool,
    model: info.modelId,
    prompt: info.prompt,
    sources: basePaths,
    usedItemPhotos: true,
    notes: 'Огляд 17.11: голова опущена (успадковано із селфі), фон світло-сірий, оливковий шар схожий на сорочку. Схожість не прийнята.',
    review: 'pending',
    favorite: false,
    createdAt: at,
  });
}
