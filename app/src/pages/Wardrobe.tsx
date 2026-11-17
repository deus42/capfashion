import { useEffect, useState } from 'react';
import { Check, CircleDashed, Merge, Plus, RotateCcw, Search, Split, X } from 'lucide-react';
import type { Category, Item, ItemStatus } from '../api.ts';
import { api, media } from '../api.ts';
import { go, useApp, useDb } from '../store.tsx';
import { Badge, Drawer, Empty, Img, Modal, UploadButton } from '../components/ui.tsx';
import { CATEGORY_LABEL, fmtDate, looksUsing } from '../lib.ts';
import { TermLinks } from './Glossary.tsx';

const STATUS_LABEL: Record<ItemStatus, string> = { needs_confirmation: 'Потребує підтвердження', confirmed: 'Підтверджено', inactive: 'Неактуальна' };
const STATUS_TONE: Record<ItemStatus, string> = { needs_confirmation: 'warn', confirmed: 'ok', inactive: '' };
const CATS = Object.keys(CATEGORY_LABEL) as Category[];

function ItemDrawer({ item, onClose }: { item: Item; onClose: () => void }) {
  const db = useDb();
  const { act } = useApp();
  const [form, setForm] = useState(() => ({ title: item.title, category: item.category, color: item.color ?? '', brand: item.brand ?? '', model: item.model ?? '', composition: item.composition ?? '', fit: item.fit ?? '', size: item.size ?? '' }));
  const [splitSel, setSplitSel] = useState<string[] | null>(null);
  useEffect(() => {
    setForm({ title: item.title, category: item.category, color: item.color ?? '', brand: item.brand ?? '', model: item.model ?? '', composition: item.composition ?? '', fit: item.fit ?? '', size: item.size ?? '' });
  }, [item.id, item.rev]);
  const photos = item.photoIds.map((id) => db.photos.find((p) => p.id === id)).filter(Boolean) as typeof db.photos;
  const looks = looksUsing(db, 'item', item.id);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const patch = (body: Record<string, unknown>, msg: string) => act(() => api('PATCH', `/api/items/${item.id}`, { rev: item.rev, ...body }), msg);
  const dirty = (Object.keys(form) as (keyof typeof form)[]).some((k) => (form[k] || '') !== ((item[k as keyof Item] as string | undefined) ?? ''));

  return (
    <Drawer
      title={
        <span className="row">
          {item.title} <span className="faint small">{item.id}</span>
        </span>
      }
      onClose={onClose}
      footer={
        <>
          {item.status !== 'confirmed' && (
            <button className="btn" onClick={() => void patch({ status: 'confirmed' }, 'Річ підтверджено')}>
              <Check size={14} /> Підтвердити наявність
            </button>
          )}
          {item.status !== 'inactive' && (
            <button className="btn" onClick={() => void patch({ status: 'inactive' }, 'Позначено неактуальною')}>
              <X size={14} /> Неактуальна
            </button>
          )}
          {item.status !== 'needs_confirmation' && (
            <button className="btn ghost" onClick={() => void patch({ status: 'needs_confirmation' }, 'Повернуто на перевірку')}>
              <RotateCcw size={14} /> На перевірку
            </button>
          )}
          <button className="btn primary" disabled={!dirty} onClick={() => void patch(form, 'Збережено')}>
            Зберегти
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        <div className="row wrap">
          <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
          <Badge>{CATEGORY_LABEL[item.category]}</Badge>
          {item.mergedInto && <Badge>обʼєднано в {item.mergedInto}</Badge>}
          {item.splitFrom && <Badge>відокремлено від {item.splitFrom}</Badge>}
        </div>
        <TermLinks texts={[item.title, item.fit, item.observation]} />

        <div>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <div className="section-title" style={{ margin: 0 }}>
              Фото <span className="count">{photos.length}</span>
            </div>
            <div className="row">
              <UploadButton kind="item" params={{ item: item.id }} className="btn sm" label="Річ" />
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
                <span className="k">
                  <Badge tone={p.kind === 'source' ? '' : 'dark'}>{p.kind === 'source' ? 'оригінал' : p.kind === 'label' ? 'етикетка' : p.kind === 'detail' ? 'деталь' : 'фото'}</Badge>
                </span>
              </button>
            ))}
            {photos.length === 0 && <span className="muted small">Фото ще немає.</span>}
          </div>
          {photos.length > 1 && (
            <div className="row" style={{ marginTop: 8 }}>
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
                <button className="btn sm ghost" onClick={() => setSplitSel([])}>
                  <Split size={13} /> Розділити помилкову групу
                </button>
              )}
            </div>
          )}
        </div>

        {item.confirmedFact && <div className="note ok">{item.confirmedFact}</div>}
        {item.observation && (
          <div className="note">
            <b className="small">Спостереження з фото:</b> {item.observation}
          </div>
        )}

        <div className="grid-form">
          <label className="field full">
            <span>Назва</span>
            <input className="input" value={form.title} onChange={set('title')} />
          </label>
          <label className="field">
            <span>Категорія</span>
            <select className="select" value={form.category} onChange={set('category')}>
              {CATS.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Колір</span>
            <input className="input" value={form.color} onChange={set('color')} placeholder="невідомо" />
          </label>
          <label className="field">
            <span>Бренд (підтверджений)</span>
            <input className="input" value={form.brand} onChange={set('brand')} placeholder="невідомо" />
          </label>
          <label className="field">
            <span>Модель / артикул</span>
            <input className="input" value={form.model} onChange={set('model')} placeholder="невідомо" />
          </label>
          <label className="field">
            <span>Склад</span>
            <input className="input" value={form.composition} onChange={set('composition')} placeholder="з етикетки" />
          </label>
          <label className="field">
            <span>Крій</span>
            <input className="input" value={form.fit} onChange={set('fit')} placeholder="напр. regular tapered" />
          </label>
          <label className="field">
            <span>Мій розмір</span>
            <input className="input" value={form.size} onChange={set('size')} placeholder="у системі бренду, напр. W32 L32" />
          </label>
        </div>
        <p className="small faint">Невідомі бренд, тканина, крій чи розмір лишаються порожніми — сайт не вгадує їх з фото.</p>

        <div>
          <div className="section-title">
            Повʼязані образи <span className="count">{looks.length}</span>
          </div>
          <div className="chips">
            {looks.map((l) => (
              <a key={l.id} className="chip" href={`#/studio?look=${l.id}`}>
                {l.name}
              </a>
            ))}
            {looks.length === 0 && <span className="muted small">Не використовується в образах.</span>}
          </div>
          {item.status === 'inactive' && looks.length > 0 && <div className="note warn" style={{ marginTop: 8 }}>Річ неактуальна, але є в образах — заміни її в Примірці.</div>}
        </div>

        <details>
          <summary className="small muted" style={{ cursor: 'pointer' }}>Історія змін ({item.history.length})</summary>
          <div className="stack small" style={{ marginTop: 8 }}>
            {item.history.slice().reverse().map((h, i) => (
              <div key={i} className="row">
                <span className="faint">{fmtDate(h.at)}</span>
                <span>{h.action}</span>
                {h.note && <span className="muted">{h.note}</span>}
              </div>
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
        <label className="field full">
          <span>Назва</span>
          <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="напр. Біла Oxford-сорочка" />
        </label>
        <label className="field">
          <span>Категорія</span>
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATS.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="small muted" style={{ marginTop: 12 }}>Фото, етикетку й деталі додаси в картці речі.</p>
    </Modal>
  );
}

export function WardrobePage({ openId }: { openId?: string }) {
  const db = useDb();
  const { act } = useApp();
  const [cat, setCat] = useState<Category | 'all'>('all');
  const [status, setStatus] = useState<ItemStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const [mergeSel, setMergeSel] = useState<string[] | null>(null);
  const [creating, setCreating] = useState(false);
  const counts = { all: db.items.length, needs_confirmation: 0, confirmed: 0, inactive: 0 } as Record<ItemStatus | 'all', number>;
  for (const i of db.items) counts[i.status] += 1;
  const list = db.items.filter(
    (i) => (cat === 'all' || i.category === cat) && (status === 'all' || i.status === status) && `${i.title} ${i.id} ${i.brand ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const open = openId ? db.items.find((i) => i.id === openId) : undefined;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Гардероб</h1>
          <p>{counts.needs_confirmation} з {counts.all} речей чекають твого підтвердження. Кандидати з 25 фото не обʼєднано автоматично — підтверди, виправ або розділи.</p>
        </div>
        <div className="actions">
          {mergeSel ? (
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
                <Merge size={14} /> Обʼєднати {mergeSel.length}
              </button>
            </>
          ) : (
            <button className="btn" onClick={() => setMergeSel([])}>
              <Merge size={14} /> Обʼєднати дублікати
            </button>
          )}
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Plus size={15} /> Нова річ
          </button>
        </div>
      </div>

      <div className="stack" style={{ marginBottom: 18, gap: 10 }}>
        <div className="row wrap">
          <label className="search">
            <Search size={15} />
            <input className="input" placeholder="Пошук" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="chips">
            {(['all', 'needs_confirmation', 'confirmed', 'inactive'] as const).map((s) => (
              <button key={s} className={`chip${status === s ? ' active' : ''}`} onClick={() => setStatus(s)}>
                {s === 'all' ? 'Усі' : STATUS_LABEL[s]} <span className="k">{counts[s]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="chips">
          <button className={`chip${cat === 'all' ? ' active' : ''}`} onClick={() => setCat('all')}>Усі категорії</button>
          {CATS.map((c) => (
            <button key={c} className={`chip${cat === c ? ' active' : ''}`} onClick={() => setCat(c)}>
              {CATEGORY_LABEL[c]} <span className="k">{db.items.filter((i) => i.category === c).length}</span>
            </button>
          ))}
        </div>
      </div>

      {list.length === 0 ? (
        <Empty icon={<CircleDashed />} title="Речей не знайдено">Зміни фільтри або додай нову річ.</Empty>
      ) : (
        <div className="thumb-grid">
          {list.map((i) => {
            const photo = i.photoIds.map((id) => db.photos.find((p) => p.id === id)).find((p) => p && p.kind !== 'source') ?? db.photos.find((p) => p.id === i.photoIds[0]);
            const selected = mergeSel?.includes(i.id);
            return (
              <button
                key={i.id}
                className={`card tile${selected ? ' selected' : ''}`}
                onClick={() => (mergeSel ? setMergeSel((s) => (s!.includes(i.id) ? s!.filter((x) => x !== i.id) : [...s!, i.id])) : go(`/wardrobe/${i.id}`))}
              >
                <div className="img">
                  <Img path={photo?.path} w={420} alt={i.title} />
                  <span className="corner">
                    <Badge tone={STATUS_TONE[i.status]}>{i.status === 'needs_confirmation' ? 'звірити' : i.status === 'confirmed' ? 'моя річ' : 'неактуальна'}</Badge>
                  </span>
                  {mergeSel && <span className="sel">{selected && <Check size={14} />}</span>}
                </div>
                <div className="meta">
                  <b>{i.title}</b>
                  <span className="id">
                    {i.id} · {CATEGORY_LABEL[i.category]} · {i.photoIds.length} фото
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {open && <ItemDrawer item={open} onClose={() => go('/wardrobe')} />}
      {creating && <NewItem onClose={() => setCreating(false)} />}
    </div>
  );
}
