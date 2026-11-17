import { useEffect, useState } from 'react';
import { Check, ExternalLink, Pencil, Plus, ShoppingBag, Store, Trash2, Undo2 } from 'lucide-react';
import type { Need, Product } from '../api.ts';
import { api, thumb } from '../api.ts';
import { useApp, useDb } from '../store.tsx';
import { Badge, CategoryIcon, ConfirmButton, Empty, Img, Modal, UploadButton } from '../components/ui.tsx';
import { distinctLooks, fmtDay, itemArt, looksUsing, purchaseRanking, siteLooks } from '../lib.ts';
import { TermInfo } from './Glossary.tsx';

const STALE_DAYS = 14;

type ProductForm = Record<'store' | 'brand' | 'model' | 'sku' | 'url' | 'composition' | 'fit' | 'price' | 'currency' | 'recommendedSize' | 'sizeBasis' | 'checkedAt' | 'sources' | 'onlineAvailability' | 'towerAvailability', string>;

function ProductEditor({ need, product, onClose }: { need: Need; product?: Product; onClose: () => void }) {
  const { act } = useApp();
  const [f, setF] = useState<ProductForm>({
    store: product?.store ?? '',
    brand: product?.brand ?? '',
    model: product?.model ?? '',
    sku: product?.sku ?? '',
    url: product?.url ?? '',
    composition: product?.composition ?? '',
    fit: product?.fit ?? '',
    price: product?.price != null ? String(product.price) : '',
    currency: product?.currency ?? 'EUR',
    recommendedSize: product?.recommendedSize ?? '',
    sizeBasis: product?.sizeBasis ?? '',
    checkedAt: product?.checkedAt ?? new Date().toISOString().slice(0, 10),
    sources: product?.sources ?? '',
    onlineAvailability: product?.onlineAvailability ?? 'unknown',
    towerAvailability: product?.towerAvailability ?? 'unknown',
  });
  const set = (k: keyof ProductForm) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    const body = { ...f, checkedAt: new Date().toISOString().slice(0, 10), needId: need.id, rev: product?.rev };
    const ok = await act(() => (product ? api('PATCH', `/api/products/${product.id}`, body) : api('POST', '/api/products', body)), 'Товар збережено');
    if (ok) onClose();
  };
  const field = (k: keyof ProductForm, label: string, placeholder = '', full = false) => (
    <label className={`field${full ? ' full' : ''}`}>
      <span>{label}</span>
      <input className="input" value={f[k]} onChange={k === 'price' ? (e) => set(k)({ target: { value: e.target.value.replace(',', '.') } }) : set(k)} placeholder={placeholder} inputMode={k === 'price' ? 'decimal' : undefined} />
    </label>
  );
  return (
    <Modal
      title={product ? 'Редагувати товар' : `Товар для «${need.title}»`}
      onClose={onClose}
      footer={
        <>
          {product && (
            <ConfirmButton className="btn ghost danger" title="Видалити товар" message={`Видалити ${product.brand} ${product.model}?`} onConfirm={async () => { const ok = await act(() => api('DELETE', `/api/products/${product.id}`), 'Товар видалено'); if (ok !== undefined) onClose(); }}>
              <Trash2 size={14} />
            </ConfirmButton>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Скасувати</button>
          <button className="btn primary" onClick={() => void save()}>Зберегти</button>
        </>
      }
    >
      <div className="grid-form">
        {field('store', 'Магазин у Tower Center Rijeka', 'напр. Massimo Dutti')}
        {field('brand', 'Бренд')}
        {field('model', 'Модель', 'назва моделі')}
        {field('url', 'URL', 'https://…', true)}
        {field('price', 'Ціна', '0.00')}
        {field('recommendedSize', 'Розмір')}
      </div>
    </Modal>
  );
}

function PurchaseModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const { act } = useApp();
  const [size, setSize] = useState(product.recommendedSize ?? '');
  const [photoId, setPhotoId] = useState<string | undefined>();
  return (
    <Modal
      title="Позначити купленим"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Скасувати</button>
          <button
            className="btn primary"
            onClick={async () => {
              const ok = await act(() => api('POST', `/api/products/${product.id}/purchase`, { size, photoId }), 'Річ додано в гардероб, образи оновлено');
              if (ok) onClose();
            }}
          >
            <Check size={14} /> Куплено
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <p>
          <b>{product.brand} {product.model}</b> перейде в гардероб як твоя річ. Образи з цією потребою отримають нову версію з цією річчю.
        </p>
        <label className="field">
          <span>Мій розмір (у системі бренду)</span>
          <input className="input" value={size} onChange={(e) => setSize(e.target.value)} placeholder="напр. M або W32 L32" />
        </label>
        <div className="row">
          <UploadButton kind="item" multiple={false} className="btn sm" label={photoId ? 'Фото додано ✓' : 'Додати своє фото'} onDone={(ids) => setPhotoId(ids[0])} />
        </div>
      </div>
    </Modal>
  );
}

function ProductCard({ p, need }: { p: Product; need: Need }) {
  const db = useDb();
  const [edit, setEdit] = useState(false);
  const [buy, setBuy] = useState(false);
  const photo = p.photoId ? db.photos.find((x) => x.id === p.photoId) : undefined;
  const stale = p.checkedAt && Date.now() - new Date(p.checkedAt).getTime() > STALE_DAYS * 864e5;
  return (
    <div className={`product${p.status === 'chosen' ? ' chosen' : ''}`}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ width: 54, height: 66, borderRadius: 8, overflow: 'hidden', background: '#f0f0ee', flex: 'none' }}>
          {photo ? <Img path={photo.path} w={160} /> : null}
        </div>
        <div className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
          <b>{p.brand} {p.model}</b>
          <span className="small muted"><Store size={11} /> {p.store}</span>
          <span className="small">{p.price != null ? `${p.price} ${p.currency ?? ''}` : 'Ціна невідома'}</span>
        </div>
        {p.status === 'chosen' && <Badge tone="dark">вибрано</Badge>}
        {p.status === 'purchased' && <Badge tone="ok">куплено</Badge>}
      </div>
      {p.recommendedSize && <span className="small">Розмір <b>{p.recommendedSize}</b></span>}
      {stale && <span className="small" style={{ color: 'var(--warn)' }}>Ціну перевірено {fmtDay(p.checkedAt!)}</span>}
      <div className="row wrap" style={{ marginTop: 4 }}>
        {p.url && (
          <a className="btn sm ghost" href={p.url} target="_blank" rel="noreferrer">
            <ExternalLink size={12} /> Сайт
          </a>
        )}
        {p.status !== 'purchased' && (
          <>
            <button className="icon-btn" aria-label="Редагувати товар" onClick={() => setEdit(true)}><Pencil size={13} /></button>
            <button className="btn sm primary" onClick={() => setBuy(true)}>
              <Check size={12} /> Куплено
            </button>
          </>
        )}
      </div>
      {edit && <ProductEditor need={need} product={p} onClose={() => setEdit(false)} />}
      {buy && <PurchaseModal product={p} onClose={() => setBuy(false)} />}
    </div>
  );
}

type CoverReply = { looks: number; queued: number; waiting: number };

const coverToast = (verb: string, r: CoverReply) =>
  [verb, r.looks ? `образів оновлено: ${r.looks}` : '', r.queued ? `нових примірок: ${r.queued}` : '', r.waiting ? `примірок чекає: ${r.waiting}` : ''].filter(Boolean).join(' · ');

/** "Вже маю": pick the owner's item that is what the recommendation asked for. */
function CoverModal({ need, onClose }: { need: Need; onClose: () => void }) {
  const db = useDb();
  const { act, toast } = useApp();
  const items = db.items.filter((i) => i.category === need.category && i.status !== 'inactive' && !i.mergedInto);
  const cover = async (itemId: string) => {
    const r = await act(() => api<CoverReply>('POST', `/api/needs/${need.id}/cover`, { itemId }));
    if (!r) return;
    toast(coverToast('Прибрано з покупок', r));
    onClose();
  };
  return (
    <Modal title={`Вже маю: ${need.title}`} onClose={onClose} wide>
      {items.length === 0 ? (
        <p className="muted">У гардеробі немає речей цієї категорії. Додай фото — збіг знайдеться сам.</p>
      ) : (
        <div className="own-picks">
          {items.map((i) => {
            const { art, photo } = itemArt(db, i.id);
            return (
              <button key={i.id} className="own-pick" onClick={() => void cover(i.id)}>
                <span className="img"><Img path={art ?? photo} w={320} alt={i.title} /></span>
                <span>{i.title}</span>
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

const inLooks = (n: number) => `у ${n} ${n === 1 ? 'образі' : 'образах'}`;
const willComplete = (n: number) => (n === 1 ? '1 стане готовим' : `${n} стануть готовими`);

/** The one purchase that helps most right now (owner, 17.11): it completes or brings closer the most looks. */
export function NextPurchase() {
  const db = useDb();
  const top = purchaseRanking(db)[0];
  if (!top || top.looksIn === 0) return null;
  const n = top.need;
  const art = n.conceptPhotoId ? db.photos.find((p) => p.id === n.conceptPhotoId)?.path : undefined;
  return (
    <a className="next-buy" href={`/shopping?need=${n.id}`}>
      <span className="img">{art ? <img src={thumb(art, 600)} alt={n.title} /> : <CategoryIcon category={n.category} size={34} />}</span>
      <span className="txt">
        <span className="eyebrow">Наступна покупка</span>
        <span className="t">{n.title}</span>
        <span className="miss">{inLooks(top.looksIn)}{top.completes ? ` · ${willComplete(top.completes)}` : ''}</span>
      </span>
    </a>
  );
}

function NeedCard({ need, focus, top = false }: { need: Need; focus: boolean; top?: boolean }) {
  const db = useDb();
  const { act, toast } = useApp();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [owning, setOwning] = useState(false);
  const products = db.products.filter((p) => p.needId === need.id);
  const covered = need.coveredByItem ? db.items.find((i) => i.id === need.coveredByItem) : undefined;
  const bought = products.some((p) => p.status === 'purchased');
  const replacedIn = need.coveredLookIds?.map((id) => db.looks.find((l) => l.id === id)).filter((l): l is NonNullable<typeof l> => Boolean(l)) ?? [];
  const using = looksUsing(db, 'need', need.id);
  const looks = need.status === 'covered' ? distinctLooks(db, replacedIn) : siteLooks(db).filter((l) => using.some((x) => x.id === l.id));
  const uncover = async () => {
    const r = await act(() => api<CoverReply>('POST', `/api/needs/${need.id}/uncover`));
    if (r) toast(coverToast('Повернуто в покупки', r));
  };
  return (
    <div id={`need-${need.id}`} className="card need-card">
      <div className="art">
        {need.conceptPhotoId && db.photos.find((p) => p.id === need.conceptPhotoId) ? (
          <img src={thumb(db.photos.find((p) => p.id === need.conceptPhotoId)!.path, 360)} alt={need.title} />
        ) : covered?.packshotId && db.photos.find((p) => p.id === covered.packshotId) ? (
          <img src={thumb(db.photos.find((p) => p.id === covered.packshotId)!.path, 360)} alt={need.title} />
        ) : (
          <CategoryIcon category={need.category} size={30} />
        )}
      </div>
      <div className="stack" style={{ gap: 14, minWidth: 0 }}>
      <div className="need-head">
        <div className="grow stack" style={{ gap: 4 }}>
          {top && <span className="eyebrow-sm">Наступна покупка</span>}
          <div className="row wrap">
            <h3>{need.title}<TermInfo texts={[need.title, need.description]} /></h3>
            {need.status === 'covered' && <Badge tone="ok">{bought ? 'куплено' : 'вже є'}</Badge>}
          </div>
        </div>
        {need.status === 'open' && (
          <>
            <button className="btn sm" onClick={() => setOwning(true)}>
              <Check size={13} /> Вже маю
            </button>
          </>
        )}
        {need.status === 'covered' && covered && !bought && (
          <button className="btn sm" onClick={() => void uncover()}>
            <Undo2 size={13} /> Повернути в покупки
          </button>
        )}
        <button className="icon-btn" aria-label="Редагувати покупку" onClick={() => setEditing(true)}><Pencil size={14} /></button>
      </div>
      <div className="kv">
        <dt>Навіщо</dt>
        <dd>{need.why || '—'}</dd>
        <dt>Що перевірити</dt>
        <dd>{need.fitCheck || '—'}</dd>
        <dt>{need.status === 'covered' ? 'Замінено в образах' : 'Доповнить образи'}</dt>
        <dd>
          <div className="chips">
            {looks.length === 0 && <span className="muted small">не використовується</span>}
            {looks.map((l) => (
              <a key={l.id} className="badge" href={`/looks/${l.id}`}>{l.name}</a>
            ))}
          </div>
        </dd>
        {covered && (
          <>
            <dt>{bought ? 'Куплено' : 'Своя річ'}</dt>
            <dd><a href={`/wardrobe/${covered.id}`} style={{ textDecoration: 'underline' }}>{covered.title}</a></dd>
          </>
        )}
      </div>
      {products.length > 0 && (
        <div className="product-grid">
          {products.map((p) => <ProductCard key={p.id} p={p} need={need} />)}
        </div>
      )}
      {products.length > 1 && <span className="small faint">Альтернативи — це варіанти однієї покупки, не кілька обовʼязкових.</span>}
      </div>
      {adding && <ProductEditor need={need} onClose={() => setAdding(false)} />}
      {editing && (
        <Modal
          title={need.title}
          onClose={() => setEditing(false)}
          footer={
            <>
              <ConfirmButton className="btn ghost danger" title="Видалити покупку" message={<>Видалити «{need.title}»?{using.length ? ` Вона зникне з ${using.length} образів.` : ''}</>} onConfirm={async () => { const ok = await act(() => api('DELETE', `/api/needs/${need.id}`), 'Видалено'); if (ok !== undefined) setEditing(false); }}>
                <Trash2 size={14} />
              </ConfirmButton>
              <span style={{ flex: 1 }} />
              {need.status === 'open' && <button className="btn primary" onClick={() => { setEditing(false); setAdding(true); }}><Plus size={14} /> Товар у магазині</button>}
            </>
          }
        >
          <p className="muted">{need.description}</p>
        </Modal>
      )}
      {owning && <CoverModal need={need} onClose={() => setOwning(false)} />}
    </div>
  );
}

export function ShoppingPage({ focus }: { focus?: string }) {
  const db = useDb();
  const [show, setShow] = useState<'open' | 'all'>('open');
  const focusCovered = Boolean(focus && db.needs.find((n) => n.id === focus)?.status === 'covered');
  useEffect(() => {
    // A link to a covered recommendation (from the wardrobe) must still find it.
    if (focusCovered) setShow('all');
    if (focus) window.setTimeout(() => document.getElementById(`need-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }, [focus, focusCovered]);
  // Ordered by the next-purchase rating; closed ones after the open ones.
  const order = new Map(purchaseRanking(db).map((r, i) => [r.need.id, i]));
  const needs = db.needs
    .filter((n) => show === 'all' || n.status === 'open')
    .sort((a, b) => (order.get(a.id) ?? 1e6) - (order.get(b.id) ?? 1e6));
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Покупки</h1>
        </div>
        <div className="actions chips">
          <button className={`chip${show === 'open' ? ' active' : ''}`} onClick={() => setShow('open')}>Відкриті</button>
          <button className={`chip${show === 'all' ? ' active' : ''}`} onClick={() => setShow('all')}>Усі</button>
          <a className="btn sm ghost" href="https://tower-center-rijeka.hr/trgovine" target="_blank" rel="noreferrer">
            <ExternalLink size={12} /> Магазини Tower
          </a>
        </div>
      </div>
      {needs.length === 0 ? (
        <Empty icon={<ShoppingBag />} title="Відкритих покупок немає" />
      ) : (
        <div className="list">
          {needs.map((n, i) => <NeedCard key={n.id} need={n} focus={n.id === focus} top={i === 0 && n.status === 'open'} />)}
        </div>
      )}
    </div>
  );
}
