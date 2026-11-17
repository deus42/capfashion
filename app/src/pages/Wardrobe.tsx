import { useEffect, useState } from 'react';
import { Archive, Camera, Check, CircleCheck, CircleDashed, Grid2x2, Loader2, Merge, PersonStanding, Plus, RotateCcw, Search, Sparkles, Split, Trash2, Wand2, X } from 'lucide-react';
import type { Category, Item, ItemStatus } from '../api.ts';
import { api, media, thumb } from '../api.ts';
import { go, useApp, useDb } from '../store.tsx';
import { Badge, CategoryIcon, ConfirmButton, Drawer, Empty, Img, Modal, PageHead, SubNav, UploadButton } from '../components/ui.tsx';
import { CATEGORY_LABEL, coverForLook, distinctLooks, fmtDate, looksUsing } from '../lib.ts';
import { hiddenLookIds } from '../rating.ts';
import type { Capsule, DB, Look } from '../api.ts';

function groupByCapsule(db: DB, looks: Look[]) {
  const groups: { capsule?: Capsule; looks: Look[] }[] = [];
  for (const l of looks) {
    const capsule = db.capsules.find((c) => c.id === l.capsuleId);
    const g = groups.find((x) => x.capsule?.id === capsule?.id);
    if (g) g.looks.push(l);
    else groups.push({ capsule, looks: [l] });
  }
  return groups;
}
import { TermLinks } from './Glossary.tsx';
import { useIntake } from './Home.tsx';

const STATUS_LABEL: Record<ItemStatus, string> = { needs_confirmation: 'Потребує підтвердження', confirmed: 'Підтверджено', inactive: 'Неактуальна' };
const STATUS_SHORT: Record<ItemStatus, string> = { needs_confirmation: 'звірити', confirmed: 'моя річ', inactive: 'неактуальна' };
const STATUS_TONE: Record<ItemStatus, string> = { needs_confirmation: 'warn', confirmed: 'ok', inactive: '' };
const CATS = Object.keys(CATEGORY_LABEL) as Category[];

function usePackshotState() {
  const db = useDb();
  const busy = new Map<string, 'queued' | 'running'>();
  for (const j of db.jobs) if (j.kind === 'packshot' && j.itemId && (j.state === 'queued' || j.state === 'running')) busy.set(j.itemId, j.state);
  return busy;
}

function ItemDrawer({ item, onClose }: { item: Item; onClose: () => void }) {
  const db = useDb();
  const { act } = useApp();
  const busy = usePackshotState();
  const blank = () => ({ title: item.title, category: item.category, color: item.color ?? '', brand: item.brand ?? '', model: item.model ?? '', composition: item.composition ?? '', fit: item.fit ?? '', size: item.size ?? '' });
  const [form, setForm] = useState(blank);
  const [splitSel, setSplitSel] = useState<string[] | null>(null);
  useEffect(() => setForm(blank()), [item.id, item.rev]);
  const photos = item.photoIds.map((id) => db.photos.find((p) => p.id === id)).filter(Boolean) as typeof db.photos;
  const packshot = item.packshotId ? db.photos.find((p) => p.id === item.packshotId) : undefined;
  const looks = distinctLooks(db, looksUsing(db, 'item', item.id));
  const set = (k: keyof ReturnType<typeof blank>) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const patch = (body: Record<string, unknown>, msg: string) => act(() => api('PATCH', `/api/items/${item.id}`, { rev: item.rev, ...body }), msg);
  const dirty = (Object.keys(form) as (keyof ReturnType<typeof blank>)[]).some((k) => (form[k] || '') !== ((item[k as keyof Item] as string | undefined) ?? ''));
  const state = busy.get(item.id);

  return (
    <Drawer
      title={<span className="row">{item.title} <span className="faint small" style={{ whiteSpace: 'nowrap' }}>{item.id}</span></span>}
      onClose={onClose}
      footer={
        <>
          <ConfirmButton
            className="btn ghost danger"
            title="Видалити річ"
            message={<>Видалити «{item.title}» з гардероба?{looks.length ? ` Вона зникне з ${looks.length} образів.` : ''} Якщо річ просто більше не носиш — краще «Неактуальна».</>}
            onConfirm={async () => {
              const ok = await act(() => api('DELETE', `/api/items/${item.id}`), 'Річ видалено');
              if (ok !== undefined) onClose();
            }}
          >
            <Trash2 size={15} />
          </ConfirmButton>
          <span style={{ flex: 1 }} />
          {item.status !== 'confirmed' && (
            <button className="btn" onClick={() => void patch({ status: 'confirmed' }, 'Річ підтверджено')}>
              <Check size={15} /> Так, це моя річ
            </button>
          )}
          {item.status !== 'inactive' && (
            <button className="btn" onClick={() => void patch({ status: 'inactive' }, 'Позначено неактуальною')}>
              <X size={15} /> Неактуальна
            </button>
          )}
          {item.status !== 'needs_confirmation' && (
            <button className="btn ghost" onClick={() => void patch({ status: 'needs_confirmation' }, 'Повернуто на перевірку')}>
              <RotateCcw size={15} /> На перевірку
            </button>
          )}
          <button className="btn primary" disabled={!dirty} onClick={() => void patch(form, 'Збережено')}>Зберегти</button>
        </>
      }
    >
      <div className="stack" style={{ gap: 20 }}>
        <div className="drawer-hero">
          <div className="hero-art">
            {packshot ? <img src={thumb(packshot.path, 700)} alt={item.title} /> : photos[0] ? <img src={thumb(photos[0].path, 700)} alt="" style={{ objectFit: 'cover' }} /> : <CategoryIcon category={item.category} size={28} />}
            {packshot && <span className="tl"><Badge tone="glass">packshot · реконструкція</Badge></span>}
          </div>
          <div className="stack" style={{ gap: 10 }}>
            <div className="row wrap">
              <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
              <Badge>{CATEGORY_LABEL[item.category]}</Badge>
              {item.mergedInto && <Badge>обʼєднано в {item.mergedInto}</Badge>}
              {item.splitFrom && <Badge>відокремлено від {item.splitFrom}</Badge>}
            </div>
            <TermLinks texts={[item.title, item.fit, item.observation]} />
            {item.confirmedFact && <div className="note ok small">{item.confirmedFact}</div>}
            {item.observation && <div className="note small"><b>З фото:</b> {item.observation}</div>}
            <button
              className="btn sm"
              disabled={Boolean(state)}
              onClick={() => void act(() => api('POST', '/api/packshots', { itemIds: [item.id], run: true }), 'Packshot у роботі')}
            >
              {state ? <Loader2 size={13} className="spin" /> : <Wand2 size={13} />}
              {state === 'running' ? 'Packshot генерується…' : state === 'queued' ? 'Packshot у черзі' : packshot ? 'Перегенерувати packshot' : 'Згенерувати packshot'}
            </button>
          </div>
        </div>

        <div>
          <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <div className="h2" style={{ fontSize: 15 }}>Оригінальні фото <span className="count">{photos.length}</span></div>
            <div className="row wrap">
              <UploadButton kind="item" params={{ item: item.id }} className="btn sm" label="Фото" />
              <UploadButton kind="label" params={{ item: item.id }} className="btn sm" label="Етикетка" />
              <UploadButton kind="detail" params={{ item: item.id }} className="btn sm" label="Деталь" />
            </div>
          </div>
          <div className="photo-strip">
            {photos.map((p) => (
              <button
                key={p.id}
                className={`p${splitSel?.includes(p.id) ? ' sel' : ''}`}
                onClick={() => (splitSel ? setSplitSel((s) => (s!.includes(p.id) ? s!.filter((x) => x !== p.id) : [...s!, p.id])) : window.open(media(p.path), '_blank'))}
                title={p.observation ?? p.originalName}
              >
                <Img path={p.path} w={300} />
                <span className="k"><Badge tone="glass">{p.kind === 'source' ? 'оригінал' : p.kind === 'label' ? 'етикетка' : p.kind === 'detail' ? 'деталь' : 'фото'}</Badge></span>
              </button>
            ))}
            {photos.length === 0 && <span className="muted small">Фото ще немає.</span>}
          </div>
          {photos.length > 1 && (
            <div className="row" style={{ marginTop: 10 }}>
              {splitSel ? (
                <>
                  <span className="small muted">Вибери фото, що належать іншій речі.</span>
                  <button className="btn sm" onClick={() => setSplitSel(null)}>Скасувати</button>
                  <button
                    className="btn sm primary"
                    disabled={!splitSel.length || splitSel.length === photos.length}
                    onClick={async () => {
                      const ok = await act(() => api('POST', `/api/items/${item.id}/split`, { rev: item.rev, photoIds: splitSel }), 'Окрему річ створено');
                      if (ok) setSplitSel(null);
                    }}
                  >
                    Розділити
                  </button>
                </>
              ) : (
                <button className="btn sm ghost" onClick={() => setSplitSel([])}><Split size={13} /> Розділити помилкову групу</button>
              )}
            </div>
          )}
        </div>

        <div className="grid-form">
          <label className="field full"><span>Назва</span><input className="input" value={form.title} onChange={set('title')} /></label>
          <label className="field">
            <span>Категорія</span>
            <select className="select" value={form.category} onChange={set('category')}>
              {CATS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </label>
          <label className="field"><span>Колір</span><input className="input" value={form.color} onChange={set('color')} placeholder="невідомо" /></label>
          <label className="field"><span>Бренд</span><input className="input" value={form.brand} onChange={set('brand')} placeholder="невідомо" /></label>
          <label className="field"><span>Модель / артикул</span><input className="input" value={form.model} onChange={set('model')} placeholder="невідомо" /></label>
          <label className="field"><span>Склад</span><input className="input" value={form.composition} onChange={set('composition')} placeholder="з етикетки" /></label>
          <label className="field"><span>Крій</span><input className="input" value={form.fit} onChange={set('fit')} placeholder="напр. regular tapered" /></label>
          <label className="field full"><span>Мій розмір</span><input className="input" value={form.size} onChange={set('size')} placeholder="у системі бренду, напр. W32 L32" /><span className="hint">Невідоме лишається порожнім — сайт не вгадує бренд, склад чи розмір з фото.</span></label>
        </div>

        <div>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <div className="h2" style={{ fontSize: 15 }}>У підбірках і капсулах <span className="count">{looks.length}</span></div>
            {item.status !== 'inactive' && (
              <button
                className="btn sm primary"
                onClick={async () => {
                  const ok = await act(() => api('POST', '/api/analyze', { itemIds: [item.id] }), 'Складаю образи з цією річчю — зʼявляться в «Підбірках»');
                  if (ok) onClose();
                }}
              >
                <Sparkles size={13} /> Скласти образ з нею
              </button>
            )}
          </div>
          {looks.length === 0 && <span className="muted small">Ще не використовується в образах.</span>}
          {db.needs.filter((n) => n.coveredByItem === item.id).map((n) => (
            <a key={n.id} className="row small" href={`#/shopping?need=${n.id}`} style={{ marginBottom: 10 }}>
              <Badge tone="ok">закриває покупку</Badge> {n.title}
            </a>
          ))}
          <div className="stack" style={{ gap: 14 }}>
            {groupByCapsule(db, looks).map(({ capsule, looks: ls }) => (
              <div key={capsule?.id ?? 'own'}>
                <a className="row small" href={capsule ? `#/capsules/${capsule.id}` : '#/studio'} style={{ marginBottom: 8, fontWeight: 560 }}>
                  {capsule?.name ?? 'Мої комбінації'} {capsule?.kind === 'selection' && <Badge tone="ok">з моїх речей</Badge>}
                </a>
                <div className="appears">
                  {ls.map((l) => {
                    const cover = coverForLook(db, l);
                    return (
                      <a key={l.id} className="appear" href={`#/looks/${l.id}`} title={l.name}>
                        <span className="ai">{cover ? <img src={thumb(cover.imagePath, 160)} alt="" /> : <PersonStanding size={18} />}</span>
                        <span className="an">{l.name}</span>
                      </a>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {item.status === 'inactive' && looks.length > 0 && <div className="note warn" style={{ marginTop: 8 }}>Річ неактуальна, але є в образах — заміни її в Примірці.</div>}
        </div>

        <div>
          <div className="h2" style={{ fontSize: 15, marginBottom: 8 }}>Історія</div>
          <div className="stack small">
            {item.history.slice().reverse().slice(0, 6).map((h, i) => (
              <div key={i} className="row"><span className="faint">{fmtDate(h.at)}</span><span>{h.action}</span>{h.note && <span className="muted">{h.note}</span>}</div>
            ))}
          </div>
        </div>
      </div>
    </Drawer>
  );
}

function NewItem({ onClose }: { onClose: () => void }) {
  const { act } = useApp();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<Category>('tees');
  return (
    <Modal
      title="Нова річ"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Скасувати</button>
          <button
            className="btn primary"
            onClick={async () => {
              const item = await act(() => api<Item>('POST', '/api/items', { title, category }), 'Річ додано');
              if (item) {
                onClose();
                go(`/wardrobe/${item.id}`);
              }
            }}
          >
            Додати
          </button>
        </>
      }
    >
      <div className="grid-form">
        <label className="field full"><span>Назва</span><input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="напр. Біла Oxford-сорочка" /></label>
        <label className="field">
          <span>Категорія</span>
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </label>
      </div>
      <p className="small muted" style={{ marginTop: 12 }}>Фото, етикетку й деталі додаси в картці речі; packshot згенерується з фото.</p>
    </Modal>
  );
}

export function WardrobePage({ openId }: { openId?: string }) {
  const db = useDb();
  const { act } = useApp();
  const busy = usePackshotState();
  const [view, setView] = useState<string>('all');
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'merge' | 'compose' | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const mergeSel = mode ? sel : null;
  const startMode = (m: 'merge' | 'compose') => {
    setSel([]);
    setMode(m);
  };
  const stopMode = () => {
    setSel([]);
    setMode(null);
  };
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : mode === 'compose' && s.length >= 4 ? s : [...s, id]));
  const useCount = new Map<string, number>();
  const hiddenLooks = hiddenLookIds(db);
  for (const l of db.looks) if (!hiddenLooks.has(l.id)) for (const refs of Object.values(l.slots)) for (const r of refs) if (r.kind === 'item') useCount.set(r.id, (useCount.get(r.id) ?? 0) + 1);
  const [creating, setCreating] = useState(false);
  const intake = useIntake();
  const intakeBusy = db.jobs.filter((j) => j.kind === 'intake' && (j.state === 'queued' || j.state === 'running')).length;
  const status = (['needs_confirmation', 'confirmed', 'inactive'] as ItemStatus[]).includes(view as ItemStatus) ? (view as ItemStatus) : null;
  const isNew = (i: Item) => i.origin === 'intake' && i.status === 'needs_confirmation';
  const cat = CATS.includes(view as Category) ? (view as Category) : null;
  // Inactive items only appear in the «Неактуальні» filter.
  const list = db.items.filter(
    (i) => !i.mergedInto && (view !== 'new' || isNew(i)) && (!cat || i.category === cat) && (status ? i.status === status : i.status !== 'inactive') && `${i.title} ${i.id} ${i.brand ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const visible = db.items.filter((i) => i.status !== 'inactive' && !i.mergedInto);
  const open = openId ? db.items.find((i) => i.id === openId) : undefined;
  const done = db.items.filter((i) => i.packshotId).length;
  const missing = db.items.filter((i) => !i.packshotId && i.status !== 'inactive' && !busy.has(i.id)).length;
  const title = view === 'new' ? 'Нові з фото' : cat ? CATEGORY_LABEL[cat] : status ? STATUS_LABEL[status] : 'Усі речі';

  return (
    <div className="page">
      {intake.field}
      <PageHead
        title={title}
        actions={
          mode ? null : (
            <>
              {missing > 0 && (
                <button className="btn" onClick={() => void act(() => api('POST', '/api/packshots', { all: true, run: true }), `Packshot для ${missing} речей у черзі`)} title="Згенерувати чисті фото">
                  <Wand2 size={15} /> {missing}
                </button>
              )}
              <button className="icon-btn" onClick={() => startMode('merge')} title="Обʼєднати дублікати"><Merge size={15} /></button>
              <button className="icon-btn" onClick={() => setCreating(true)} title="Додати вручну"><Plus size={16} /></button>
              <button className="btn primary" onClick={() => startMode('compose')}><Sparkles size={15} /> Доповнити образ</button>

            </>
          )
        }
      />

      {intakeBusy > 0 && (
        <div className="row" style={{ marginBottom: 12, gap: 12 }}>
          <Loader2 size={15} className="spin" />
          <span className="small muted">Розбираю фото: {intakeBusy} — нові речі з’являться тут</span>
        </div>
      )}
      {busy.size > 0 && (
        <div className="row" style={{ marginBottom: 22, gap: 12 }}>
          <Loader2 size={15} className="spin" />
          <span className="small muted" style={{ whiteSpace: 'nowrap' }}>Packshot {done}/{db.items.length}</span>
          <div className="progress" style={{ flex: 1 }}><i style={{ width: `${Math.round((done / db.items.length) * 100)}%` }} /></div>
        </div>
      )}

      <div className="split">
        <SubNav
          value={view}
          onChange={(k) => setView(k)}
          groups={[
            {
              items: [
                { key: 'all', label: 'Усі речі', icon: <Grid2x2 size={17} />, n: visible.length },
                ...(db.items.some(isNew) ? [{ key: 'new', label: 'Нові з фото', icon: <Camera size={17} />, n: db.items.filter(isNew).length }] : []),
              ],
            },
            { label: 'Категорії', items: CATS.map((c) => ({ key: c, label: CATEGORY_LABEL[c], icon: <CategoryIcon category={c} size={17} />, n: visible.filter((i) => i.category === c).length })) },
            {
              label: 'Статус',
              items: [
                { key: 'needs_confirmation', label: 'Звірити', icon: <CircleDashed size={17} />, n: db.items.filter((i) => i.status === 'needs_confirmation').length },
                { key: 'confirmed', label: 'Мої речі', icon: <CircleCheck size={17} />, n: db.items.filter((i) => i.status === 'confirmed').length },
                { key: 'inactive', label: 'Неактуальні', icon: <Archive size={17} />, n: db.items.filter((i) => i.status === 'inactive' && !i.mergedInto).length },
              ],
            },
          ]}
        />
        <div>
          <div className="toolbar">
            <label className="search">
              <Search size={15} />
              <input className="input" placeholder="Пошук речі" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <span className="grow" />
            <span className="small muted">{list.length} речей</span>
          </div>
          {list.length === 0 ? (
            <Empty icon={<CircleDashed />} title="Речей не знайдено">Зміни фільтр або додай нову річ.</Empty>
          ) : (
            <div className="ward-grid">
              {list.map((i) => {
                const packshot = i.packshotId ? db.photos.find((p) => p.id === i.packshotId) : undefined;
                const photo = db.photos.find((p) => p.id === i.photoIds[0]);
                const selected = mergeSel?.includes(i.id);
                const st = busy.get(i.id);
                return (
                  <button
                    key={i.id}
                    className={`wtile${selected ? ' selected' : ''}`}
                    onClick={() => (mode ? toggle(i.id) : go(`/wardrobe/${i.id}`))}
                  >
                    <div className="img">
                      {packshot ? <img src={thumb(packshot.path, 480)} alt={i.title} loading="lazy" /> : photo ? <img className="photo" src={thumb(photo.path, 480)} alt={i.title} loading="lazy" /> : null}
                      {i.status !== 'needs_confirmation' && <span className="tl"><Badge tone={`${STATUS_TONE[i.status]} glass`}>{STATUS_SHORT[i.status]}</Badge></span>}
                      {i.origin === 'intake' && i.status === 'needs_confirmation' && <span className="tl"><Badge tone="info glass">нова</Badge></span>}
                      {mergeSel && <span className="tr sel-box">{selected && <Check size={14} />}</span>}
                      {!mergeSel && (useCount.get(i.id) ?? 0) > 0 && <span className="uses" title="У скількох образах">{useCount.get(i.id)} обр.</span>}
                      {st && <span className="gen"><Loader2 size={12} className={st === 'running' ? 'spin' : ''} /> {st === 'running' ? 'Packshot генерується' : 'Packshot у черзі'}</span>}
                    </div>
                    <span className="nm">{i.title}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {mode && (
        <div className="sel-bar">
              <span className="small muted">{mode === 'compose' ? `Вибери 1–4 речі · ${sel.length}` : `Вибери дублікати · ${sel.length}`}</span>
              <button className="btn" onClick={stopMode}>Скасувати</button>
              {mode === 'merge' ? (
                <button
                  className="btn primary"
                  disabled={sel.length < 2}
                  onClick={async () => {
                    const ok = await act(() => api<Item>('POST', '/api/items/merge', { ids: sel }), 'Дублікати обʼєднано, джерела збережено');
                    if (ok) {
                      stopMode();
                      go(`/wardrobe/${ok.id}`);
                    }
                  }}
                >
                  <Merge size={15} /> Обʼєднати {sel.length}
                </button>
              ) : (
                <button
                  className="btn primary"
                  disabled={sel.length < 1}
                  onClick={async () => {
                    const ok = await act(() => api('POST', '/api/analyze', { itemIds: sel }), 'Складаю образи з вибраних речей — зʼявляться в «Підбірках»');
                    if (ok) stopMode();
                  }}
                >
                  <Sparkles size={15} /> Доповнити {sel.length || ''}
                </button>
              )}
                    </div>
      )}
      {open && <ItemDrawer item={open} onClose={() => go('/wardrobe')} />}
      {creating && <NewItem onClose={() => setCreating(false)} />}
    </div>
  );
}
