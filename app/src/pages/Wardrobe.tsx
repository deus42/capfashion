import { useEffect, useState } from 'react';
import { Archive, Camera, Check, CircleCheck, CircleDashed, Grid2x2, Loader2, Merge, Plus, RotateCcw, Search, Split, Wand2, X } from 'lucide-react';
import type { Category, Item, ItemStatus } from '../api.ts';
import { api, media, thumb } from '../api.ts';
import { go, useApp, useDb } from '../store.tsx';
import { Badge, CategoryIcon, Drawer, Empty, Img, Modal, PageHead, SubNav, UploadButton } from '../components/ui.tsx';
import { CATEGORY_LABEL, fmtDate, looksUsing } from '../lib.ts';
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
  const looks = looksUsing(db, 'item', item.id);
  const set = (k: keyof ReturnType<typeof blank>) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const patch = (body: Record<string, unknown>, msg: string) => act(() => api('PATCH', `/api/items/${item.id}`, { rev: item.rev, ...body }), msg);
  const dirty = (Object.keys(form) as (keyof ReturnType<typeof blank>)[]).some((k) => (form[k] || '') !== ((item[k as keyof Item] as string | undefined) ?? ''));
  const state = busy.get(item.id);

  return (
    <Drawer
      title={<span className="row">{item.title} <span className="faint small">{item.id}</span></span>}
      onClose={onClose}
      footer={
        <>
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
        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 18, alignItems: 'start' }}>
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
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <div className="h2" style={{ fontSize: 15 }}>Оригінальні фото <span className="count">{photos.length}</span></div>
            <div className="row">
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
          <div className="h2" style={{ fontSize: 15, marginBottom: 10 }}>Повʼязані образи <span className="count">{looks.length}</span></div>
          <div className="chips">
            {looks.map((l) => <a key={l.id} className="chip" href={`#/studio?look=${l.id}`}>{l.name}</a>)}
            {looks.length === 0 && <span className="muted small">Не використовується в образах.</span>}
          </div>
          {item.status === 'inactive' && looks.length > 0 && <div className="note warn" style={{ marginTop: 8 }}>Річ неактуальна, але є в образах — заміни її в Примірці.</div>}
        </div>

        <details>
          <summary className="small muted" style={{ cursor: 'pointer' }}>Історія змін ({item.history.length})</summary>
          <div className="stack small" style={{ marginTop: 8 }}>
            {item.history.slice().reverse().map((h, i) => (
              <div key={i} className="row"><span className="faint">{fmtDate(h.at)}</span><span>{h.action}</span>{h.note && <span className="muted">{h.note}</span>}</div>
            ))}
          </div>
        </details>
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
  const [mergeSel, setMergeSel] = useState<string[] | null>(null);
  const [creating, setCreating] = useState(false);
  const intake = useIntake();
  const intakeBusy = db.jobs.filter((j) => j.kind === 'intake' && (j.state === 'queued' || j.state === 'running')).length;
  const status = (['needs_confirmation', 'confirmed', 'inactive'] as ItemStatus[]).includes(view as ItemStatus) ? (view as ItemStatus) : null;
  const cat = CATS.includes(view as Category) ? (view as Category) : null;
  const list = db.items.filter(
    (i) => (!cat || i.category === cat) && (!status ? i.status !== 'inactive' || view === 'all' : i.status === status) && `${i.title} ${i.id} ${i.brand ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const open = openId ? db.items.find((i) => i.id === openId) : undefined;
  const done = db.items.filter((i) => i.packshotId).length;
  const missing = db.items.filter((i) => !i.packshotId && i.status !== 'inactive' && !busy.has(i.id)).length;
  const title = cat ? CATEGORY_LABEL[cat] : status ? STATUS_LABEL[status] : 'Усі речі';

  return (
    <div className="page">
      {intake.field}
      <PageHead
        title={title}
        actions={
          mergeSel ? (
            <>
              <button className="btn" onClick={() => setMergeSel(null)}>Скасувати</button>
              <button
                className="btn primary"
                disabled={mergeSel.length < 2}
                onClick={async () => {
                  const ok = await act(() => api<Item>('POST', '/api/items/merge', { ids: mergeSel }), 'Дублікати обʼєднано, джерела збережено');
                  if (ok) {
                    setMergeSel(null);
                    go(`/wardrobe/${ok.id}`);
                  }
                }}
              >
                <Merge size={15} /> Обʼєднати {mergeSel.length}
              </button>
            </>
          ) : (
            <>
              {missing > 0 && (
                <button className="btn" onClick={() => void act(() => api('POST', '/api/packshots', { all: true, run: true }), `Packshot для ${missing} речей у черзі`)} title="Згенерувати чисті фото">
                  <Wand2 size={15} /> {missing}
                </button>
              )}
              <button className="icon-btn" onClick={() => setMergeSel([])} title="Обʼєднати дублікати"><Merge size={15} /></button>
              <button className="icon-btn" onClick={() => setCreating(true)} title="Додати вручну"><Plus size={16} /></button>
              <button className="btn primary" onClick={intake.pick} disabled={intake.busy}>
                {intake.busy || intakeBusy ? <Loader2 size={16} className="spin" /> : <Camera size={16} />} Фото одягу{intakeBusy ? ` · ${intakeBusy}` : ''}
              </button>
            </>
          )
        }
      />

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
            { items: [{ key: 'all', label: 'Усі речі', icon: <Grid2x2 size={17} />, n: db.items.length }] },
            { label: 'Категорії', items: CATS.map((c) => ({ key: c, label: CATEGORY_LABEL[c], icon: <CategoryIcon category={c} size={17} />, n: db.items.filter((i) => i.category === c).length })) },
            {
              label: 'Статус',
              items: [
                { key: 'needs_confirmation', label: 'Звірити', icon: <CircleDashed size={17} />, n: db.items.filter((i) => i.status === 'needs_confirmation').length },
                { key: 'confirmed', label: 'Мої речі', icon: <CircleCheck size={17} />, n: db.items.filter((i) => i.status === 'confirmed').length },
                { key: 'inactive', label: 'Неактуальні', icon: <Archive size={17} />, n: db.items.filter((i) => i.status === 'inactive').length },
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
                    onClick={() => (mergeSel ? setMergeSel((s) => (s!.includes(i.id) ? s!.filter((x) => x !== i.id) : [...s!, i.id])) : go(`/wardrobe/${i.id}`))}
                  >
                    <div className="img">
                      {packshot ? <img src={thumb(packshot.path, 480)} alt={i.title} loading="lazy" /> : photo ? <img className="photo" src={thumb(photo.path, 480)} alt={i.title} loading="lazy" /> : null}
                      {i.status !== 'needs_confirmation' && <span className="tl"><Badge tone={`${STATUS_TONE[i.status]} glass`}>{STATUS_SHORT[i.status]}</Badge></span>}
                      {i.origin === 'intake' && i.status === 'needs_confirmation' && <span className="tl"><Badge tone="info glass">нова</Badge></span>}
                      {mergeSel && <span className="tr sel-box">{selected && <Check size={14} />}</span>}
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
      {open && <ItemDrawer item={open} onClose={() => go('/wardrobe')} />}
      {creating && <NewItem onClose={() => setCreating(false)} />}
    </div>
  );
}
