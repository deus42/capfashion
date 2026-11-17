import { useState } from 'react';
import { Archive, Camera, Check, CircleCheck, CircleDashed, Grid2x2, Merge, Pencil, Plus, Search, Sparkles, Trash2, Wand2 } from 'lucide-react';
import type { Category, Item, ItemStatus } from '../api.ts';
import { api, media, thumb } from '../api.ts';
import { go, useApp, useDb } from '../store.tsx';
import { Badge, CategoryIcon, ConfirmButton, Empty, LookArt, Missing, Modal, PageHead, SubNav, UploadButton } from '../components/ui.tsx';
import { CATEGORY_LABEL, siteLooks } from '../lib.ts';

import { TermInfo } from './Glossary.tsx';

const STATUS_LABEL: Record<ItemStatus, string> = { needs_confirmation: 'Потребує підтвердження', confirmed: 'Підтверджено', inactive: 'Неактуальна' };
const STATUS_SHORT: Record<ItemStatus, string> = { needs_confirmation: 'звірити', confirmed: 'моя річ', inactive: 'неактуальна' };
const STATUS_TONE: Record<ItemStatus, string> = { needs_confirmation: 'warn', confirmed: 'ok', inactive: '' };
const CATS = Object.keys(CATEGORY_LABEL) as Category[];

function usePackshotState() {
  const db = useDb();
  const busy = new Map<string, 'queued' | 'running'>();
  for (const j of db.jobs) if (j.kind === 'packshot' && j.itemId && (j.state === 'queued' || j.state === 'running')) busy.set(j.itemId, j.state);
  // Only work that is happening now animates; queued work waits quietly.
  return busy;
}

/**
 * Minimal item page (owner, 17.11: always minimal, never side panels): the
 * picture and photos, one "Це моя річ?" question while unconfirmed, the looks
 * it is in. Everything editable sits behind the pencil.
 */
function ItemPage({ item }: { item: Item }) {
  const db = useDb();
  const { act } = useApp();
  const busy = usePackshotState();
  const [editing, setEditing] = useState(false);
  const photos = item.photoIds.map((id) => db.photos.find((p) => p.id === id)).filter(Boolean) as typeof db.photos;
  const packshot = item.packshotId ? db.photos.find((p) => p.id === item.packshotId) : undefined;
  const main = packshot ?? photos[0];
  const looks = siteLooks(db).filter((l) => Object.values(l.slots).flat().some((r) => r.kind === 'item' && r.id === item.id));
  const covers = db.needs.filter((n) => n.coveredByItem === item.id);
  const patch = (body: Record<string, unknown>, msg: string) => act(() => api('PATCH', `/api/items/${item.id}`, { rev: item.rev, ...body }), msg);

  return (
    <div className="page">
      <div className="crumb"><a href="/wardrobe">Гардероб</a></div>
      <div className="page-head">
        <div><h1>{item.title}<TermInfo texts={[item.title, item.fit]} /></h1></div>
        <div className="actions">
          <button className="icon-btn" aria-label="Редагувати річ" onClick={() => setEditing(true)}><Pencil size={14} /></button>
        </div>
      </div>

      <div className="item-hero">
        <a className="item-main" href={main ? media(main.path) : undefined} target={main ? '_blank' : undefined} rel="noreferrer">
          {main ? <img src={thumb(main.path, 960)} alt={item.title} /> : <CategoryIcon category={item.category} size={34} />}
          {busy.get(item.id) === 'running' && <span className="busy-bar" role="progressbar" aria-label="Фото речі" />}
        </a>
        <div className="item-thumbs">
          {photos.map((p) => (
            <a key={p.id} className="item-thumb" href={media(p.path)} target="_blank" rel="noreferrer"><img src={thumb(p.path, 240)} alt="" loading="lazy" /></a>
          ))}
          <UploadButton kind="item" params={{ item: item.id }} className="item-thumb add" label="" />
        </div>
      </div>

      {item.status === 'needs_confirmation' && (
        <div className="its-me">
          <span>Це моя річ?</span>
          <button className="btn" onClick={() => void patch({ status: 'inactive' }, 'Прибрано')}>Ні</button>
          <button className="btn primary" onClick={() => void patch({ status: 'confirmed' }, 'Моя річ')}><Check size={15} /> Так</button>
        </div>
      )}
      {item.status === 'inactive' && (
        <div className="its-me">
          <span>Не моя / неактуальна</span>
          <button className="btn" onClick={() => void patch({ status: 'confirmed' }, 'Повернуто')}>Повернути</button>
        </div>
      )}

      <div className="section-head">
        <h2 className="h2">Образи <span className="count">{looks.length}</span></h2>
        {item.status !== 'inactive' && (
          <button className="btn sm" onClick={() => void act(() => api('POST', '/api/analyze', { itemIds: [item.id] }), 'Складаю образи — зʼявляться в «Підбірках»')}>
            <Sparkles size={13} /> Ще образ
          </button>
        )}
      </div>
      {looks.length > 0 && (
        <div className="sib-strip">
          {looks.map((l) => (
            <a key={l.id} className="sib" href={`/looks/${l.id}`}>
              <span className="img"><LookArt look={l} w={480} /></span>
              <span className="nm">{l.name}</span>
              <Missing look={l} />
            </a>
          ))}
        </div>
      )}
      {covers.map((n) => (
        <a key={n.id} className="small muted" style={{ display: 'block', marginTop: 16 }} href={`/shopping?need=${n.id}`}>Закриває покупку «{n.title}»</a>
      ))}
      {editing && <ItemEdit item={item} onClose={() => setEditing(false)} />}
    </div>
  );
}

/** Everything editable about an item, in one modal behind the pencil. */
function ItemEdit({ item, onClose }: { item: Item; onClose: () => void }) {
  const { act } = useApp();
  const [form, setForm] = useState({ title: item.title, category: item.category, color: item.color ?? '', brand: item.brand ?? '', model: item.model ?? '', composition: item.composition ?? '', fit: item.fit ?? '', size: item.size ?? '' });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const field = (k: keyof typeof form, label: string) => (
    <label className="field"><span>{label}</span><input className="input" value={form[k]} onChange={set(k)} /></label>
  );
  const save = async () => {
    const ok = await act(() => api('PATCH', `/api/items/${item.id}`, { rev: item.rev, ...form }), 'Збережено');
    if (ok) onClose();
  };
  return (
    <Modal
      title="Річ"
      onClose={onClose}
      footer={
        <>
          <ConfirmButton
            className="btn ghost danger"
            title="Видалити річ"
            message={`Видалити «${item.title}» з гардероба? Фото-оригінали лишаться в архіві.`}
            onConfirm={async () => {
              const ok = await act(() => api('DELETE', `/api/items/${item.id}`), 'Річ видалено');
              if (ok !== undefined) go('/wardrobe');
            }}
          >
            <Trash2 size={14} />
          </ConfirmButton>
          <button className="btn ghost" onClick={() => void act(() => api('POST', '/api/packshots', { itemIds: [item.id], run: true }), 'Нове фото речі в роботі')}><Wand2 size={14} /> Нове фото</button>
          <span style={{ flex: 1 }} />
          <button className="btn primary" onClick={() => void save()}>Зберегти</button>
        </>
      }
    >
      <div className="grid-form">
        <label className="field full"><span>Назва</span><input className="input" value={form.title} onChange={set('title')} /></label>
        <label className="field">
          <span>Категорія</span>
          <select className="select" value={form.category} onChange={set('category')}>
            {CATS.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </label>
        {field('color', 'Колір')}
        {field('brand', 'Бренд')}
        {field('size', 'Розмір')}
        {field('model', 'Модель')}
        {field('composition', 'Склад')}
        {field('fit', 'Крій')}
      </div>
    </Modal>
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
  // Same count as the item page: distinct looks (near-copies fold into one).
  for (const l of siteLooks(db)) for (const id of new Set(Object.values(l.slots).flat().filter((r) => r.kind === 'item').map((r) => r.id))) useCount.set(id, (useCount.get(id) ?? 0) + 1);
  const [creating, setCreating] = useState(false);
  const status = (['needs_confirmation', 'confirmed', 'inactive'] as ItemStatus[]).includes(view as ItemStatus) ? (view as ItemStatus) : null;
  const isNew = (i: Item) => i.origin === 'intake' && i.status === 'needs_confirmation';
  const cat = CATS.includes(view as Category) ? (view as Category) : null;
  // Inactive items only appear in the «Неактуальні» filter.
  const list = db.items.filter(
    (i) => !i.mergedInto && (view !== 'new' || isNew(i)) && (!cat || i.category === cat) && (status ? i.status === status : i.status !== 'inactive') && `${i.title} ${i.id} ${i.brand ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const visible = db.items.filter((i) => i.status !== 'inactive' && !i.mergedInto);
  const open = openId ? db.items.find((i) => i.id === openId) : undefined;
  const missing = db.items.filter((i) => !i.packshotId && i.status !== 'inactive' && !busy.has(i.id)).length;
  const title = view === 'new' ? 'Нові з фото' : cat ? CATEGORY_LABEL[cat] : status ? STATUS_LABEL[status] : 'Усі речі';
  // An item opens as its own page, not a side panel over the grid.
  if (open) return <ItemPage item={open} />;

  return (
    <div className="page">
      <PageHead
        title={title}
        actions={
          mode ? null : (
            <>
              {missing > 0 && (
                <button className="btn" onClick={() => void act(() => api('POST', '/api/packshots', { all: true, run: true }), 'Роблю фото речей')} title="Фото речей">
                  <Wand2 size={15} /> Фото {missing}
                </button>
              )}
              <button className="icon-btn" onClick={() => startMode('merge')} title="Обʼєднати дублікати"><Merge size={15} /></button>
              <button className="icon-btn" onClick={() => setCreating(true)} title="Додати вручну"><Plus size={16} /></button>
              <button className="btn primary" onClick={() => startMode('compose')}><Sparkles size={15} /> Доповнити образ</button>

            </>
          )
        }
      />


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
                      {st === 'running' && <span className="busy-bar" role="progressbar" aria-label="Фото речі" />}
                    </div>
                    <span className="nm">{i.title}<TermInfo texts={[i.title]} /></span>
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
      {creating && <NewItem onClose={() => setCreating(false)} />}
    </div>
  );
}
