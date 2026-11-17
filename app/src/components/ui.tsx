import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, Footprints, ImagePlus, Layers, Loader2, PersonStanding, Shirt, ThumbsDown, ThumbsUp, Upload, Watch, X } from 'lucide-react';
import type { Category, Look, Photo, PhotoKind, Slots } from '../api.ts';
import { thumb, uploadFile } from '../api.ts';
import { useApp, useDb } from '../store.tsx';
import { api } from '../api.ts';
import { ratingOf } from '../rating.ts';
import type { ResolvedRef } from '../lib.ts';
import { REF_KIND_LABEL, coverForLook, lookBusy, piecesOf } from '../lib.ts';
import { TermInfo } from '../pages/Glossary.tsx';

export function Badge({ tone = '', children }: { tone?: string; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function KindDot({ kind }: { kind: ResolvedRef['kind'] }) {
  return <span className={`kind-dot k-${kind}`} title={REF_KIND_LABEL[kind]} />;
}

export function KindLegend() {
  return (
    <div className="legend">
      {(['owned', 'candidate', 'need', 'product'] as const).map((k) => (
        <span key={k}>
          <KindDot kind={k} /> {REF_KIND_LABEL[k]}
        </span>
      ))}
    </div>
  );
}

export function Img({ path, w = 720, alt = '', className }: { path?: string; w?: number; alt?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!path || failed) return <div className={`ph-img ${className ?? ''}`} />;
  return <img src={thumb(path, w)} alt={alt} loading="lazy" className={className} onError={() => setFailed(true)} />;
}

export function Overlay({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {children}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <Overlay onClose={onClose}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрити">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </Overlay>
  );
}


/** File input + drag-and-drop. On iPhone the picker offers camera or library. */
export function UploadButton({
  kind,
  params = {},
  label = 'Завантажити фото',
  multiple = true,
  onDone,
  className = 'btn',
}: {
  kind: PhotoKind;
  params?: Record<string, string>;
  label?: string;
  multiple?: boolean;
  onDone?: (ids: string[]) => void;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const { act } = useApp();
  const [busy, setBusy] = useState(false);
  const run = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const ids: string[] = [];
    await act(async () => {
      for (const f of Array.from(files)) ids.push((await uploadFile(f, { kind, ...params })).id);
    }, files.length > 1 ? `Завантажено ${files.length} фото` : 'Фото завантажено');
    setBusy(false);
    if (ref.current) ref.current.value = '';
    if (ids.length) onDone?.(ids);
  };
  return (
    <>
      <button type="button" className={className} onClick={() => ref.current?.click()} disabled={busy}>
        {busy ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
        {label}
      </button>
      <input ref={ref} type="file" accept="image/*,.heic,.heif" multiple={multiple} hidden onChange={(e) => void run(e.target.files)} />
    </>
  );
}

export function Dropzone({ kind, params = {}, text, onDone }: { kind: PhotoKind; params?: Record<string, string>; text: string; onDone?: (ids: string[]) => void }) {
  const { act } = useApp();
  const [over, setOver] = useState(false);
  return (
    <div
      className={`dropzone${over ? ' over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
        if (!files.length) return;
        const ids: string[] = [];
        void act(async () => {
          for (const f of files) ids.push((await uploadFile(f, { kind, ...params })).id);
        }, `Завантажено ${files.length} фото`).then(() => ids.length && onDone?.(ids));
      }}
    >
      <ImagePlus size={20} style={{ margin: '0 auto 6px' }} />
      <div>{text}</div>
      <div style={{ marginTop: 10 }}>
        <UploadButton kind={kind} params={params} onDone={onDone} className="btn sm" label="Вибрати файли" />
      </div>
    </div>
  );
}

export function PhotoPicker({
  title,
  selected,
  onClose,
  onSave,
  filter,
}: {
  title: string;
  selected: string[];
  onClose: () => void;
  onSave: (ids: string[]) => void;
  filter?: (p: Photo) => boolean;
}) {
  const db = useDb();
  const [sel, setSel] = useState<string[]>(selected);
  const photos = db.photos.filter((p) => (filter ? filter(p) : true)).slice().reverse();
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <Modal
      title={title}
      wide
      onClose={onClose}
      footer={
        <>
          <span className="muted small" style={{ marginRight: 'auto' }}>
            Вибрано: {sel.length}
          </span>
          <button className="btn" onClick={onClose}>
            Скасувати
          </button>
          <button className="btn primary" onClick={() => onSave(sel)}>
            Зберегти вибір
          </button>
        </>
      }
    >
      <div className="thumb-grid">
        {photos.map((p) => (
          <button key={p.id} className={`card tile${sel.includes(p.id) ? ' selected' : ''}`} onClick={() => toggle(p.id)}>
            <div className="img">
              <Img path={p.path} w={360} />
              <span className="sel">{sel.includes(p.id) && <Check size={14} />}</span>
              <span className="corner">
                <Badge tone={p.kind === 'base' ? 'dark' : ''}>{p.kind === 'source' ? 'чат 14.11' : p.kind === 'base' ? 'базове' : p.kind}</Badge>
              </span>
            </div>
            <div className="meta">
              <span className="id">{p.originalName}</span>
              {p.observation && <span className="small muted">{p.observation}</span>}
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="card pad" style={{ textAlign: 'center', padding: 40 }}>
      <div style={{ color: 'var(--faint)', display: 'grid', placeItems: 'center', marginBottom: 10 }}>{icon}</div>
      <b>{title}</b>
      {children && <div className="muted" style={{ marginTop: 6 }}>{children}</div>}
    </div>
  );
}

export function CategoryIcon({ category, size = 18 }: { category?: Category; size?: number }) {
  if (category === 'shoes') return <Footprints size={size} />;
  if (category === 'accessories') return <Watch size={size} />;
  if (category === 'outerwear') return <Layers size={size} />;
  return <Shirt size={size} />;
}

export function Piece({ r, w = 520 }: { r: ResolvedRef; w?: number }) {
  if (r.art) {
    return (
      <div className="piece" title={`${r.title} — ${REF_KIND_LABEL[r.kind]}`}>
        <img src={thumb(r.art, w)} alt={r.title} loading="lazy" />
      </div>
    );
  }
  return (
    <div className="piece ph" title={`${r.title} — ${REF_KIND_LABEL[r.kind]}`}>
      <span className="ico"><CategoryIcon category={r.category} size={18} /></span>
    </div>
  );
}

/** Small image row of an outfit's pieces; titles live in tooltips, not on screen. */
export function PieceStrip({ slots, size = 44 }: { slots: Slots; size?: number }) {
  const db = useDb();
  const pieces = piecesOf(db, slots);
  return (
    <div className="pstrip">
      {pieces.map((r) => (
        <span key={`${r.ref.kind}-${r.ref.id}`} className={`pthumb k-${r.kind}`} style={{ width: size, height: size }} title={`${r.title} — ${REF_KIND_LABEL[r.kind]}`}>
          {r.art ? <img src={thumb(r.art, 160)} alt="" loading="lazy" /> : <CategoryIcon category={r.category} size={Math.round(size * 0.4)} />}
        </span>
      ))}
    </div>
  );
}

/** Flat-lay of an outfit's pieces: used wherever a try-on does not exist yet. */
/** The look's best try-on, or its pieces laid out — never an empty card; a thin bar runs while a try-on is made. */
export function LookArt({ look, w = 700, max }: { look: Look; w?: number; max?: number }) {
  const db = useDb();
  const cover = coverForLook(db, look);
  return (
    <span className="look-art">
      {cover ? <img src={thumb(cover.imagePath, w)} alt={look.name} loading="lazy" /> : <LookCollage slots={look.slots} max={max} />}
      {lookBusy(db, look.id) && <span className="busy-bar" role="progressbar" aria-label="Генерую примірку" />}
    </span>
  );
}

export function LookCollage({ slots, max = 5 }: { slots: Slots; max?: number }) {
  const db = useDb();
  const pieces = piecesOf(db, slots).slice(0, max);
  if (pieces.length === 0) return <div className="collage n1"><div className="piece ph"><Shirt size={20} /><span>Образ порожній</span></div></div>;
  if (pieces.length <= 2) return <div className={`collage n${pieces.length}`}>{pieces.map((r) => <Piece key={r.ref.id} r={r} />)}</div>;
  const [first, ...rest] = pieces;
  return (
    <div className="collage">
      <Piece r={first} w={720} />
      <div className="side" style={{ gridTemplateRows: `repeat(${rest.length}, minmax(0, 1fr))` }}>
        {rest.map((r) => <Piece key={`${r.ref.kind}-${r.ref.id}`} r={r} w={360} />)}
      </div>
    </div>
  );
}

export interface SubNavItem {
  key: string;
  label: string;
  icon?: ReactNode;
  n?: number;
}

export function SubNav({ groups, value, onChange }: { groups: { label?: string; items: SubNavItem[] }[]; value: string; onChange: (key: string) => void }) {
  return (
    <nav className="subnav">
      {groups.map((g, i) => (
        <div key={i} style={{ display: 'contents' }}>
          {g.label && <div className="label">{g.label}</div>}
          {g.items.map((it) => (
            <button key={it.key} className={`subnav-item${value === it.key ? ' on' : ''}`} onClick={() => onChange(it.key)}>
              {it.icon}
              <span>{it.label}</span>
              {it.n !== undefined && <span className="n">{it.n}</span>}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function PageHead({ crumb, title, sub, actions }: { crumb?: ReactNode; title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <>
      {crumb && <div className="crumb">{crumb}</div>}
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          {sub && <p>{sub}</p>}
        </div>
        {actions && <div className="actions">{actions}</div>}
      </div>
    </>
  );
}

/** Destructive action behind a confirmation dialog. */
export function ConfirmButton({
  children,
  className = 'btn danger',
  title,
  message,
  confirmLabel = 'Видалити',
  onConfirm,
}: {
  children: ReactNode;
  className?: string;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<unknown> | void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} title={title} aria-label={title}>
        {children}
      </button>
      {open && (
        <Modal
          title={title}
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setOpen(false)}>Скасувати</button>
              <button
                className="btn primary"
                style={{ background: 'var(--bad)', borderColor: 'var(--bad)' }}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await onConfirm();
                  setBusy(false);
                  setOpen(false);
                }}
              >
                {busy ? <Loader2 size={14} className="spin" /> : null} {confirmLabel}
              </button>
            </>
          }
        >
          <div style={{ fontSize: 15 }}>{message}</div>
        </Modal>
      )}
    </>
  );
}

/** What a cover shows while the owner's try-on for these looks is not ready. */
export function RenderPlaceholder({ lookIds }: { lookIds: string[] }) {
  const db = useDb();
  const jobs = db.jobs.filter((j) => (j.kind ?? 'tryon') === 'tryon' && j.lookId && lookIds.includes(j.lookId));
  const running = jobs.some((j) => j.state === 'running');
  const queued = jobs.some((j) => j.state === 'queued');
  const waiting = jobs.find((j) => j.state === 'needs_data');
  const noBase = db.profile.basePhotoIds.length === 0;
  return (
    <div className="render-ph" title={!running && !queued ? waiting?.stateNote : undefined}>
      {running || queued ? <Loader2 size={22} className={running ? 'spin' : ''} /> : <PersonStanding size={24} />}
      <span>{running ? 'Генерую примірку…' : queued ? 'Примірка в черзі' : waiting ? 'Примірка чекає' : noBase ? 'Додай своє фото' : 'Примірки ще немає'}</span>
    </div>
  );
}

/**
 * Owner rating in black and white. Dislike hides (kept as a finished look,
 * restorable in «Капсули → Приховані»); like ranks first. Pressing the active
 * button again clears it.
 */
export function RateButtons({ kind, target, size = 'md' }: { kind: 'look' | 'capsule'; target: { id: string; favorite: boolean; disliked?: boolean }; size?: 'sm' | 'md' }) {
  const { act } = useApp();
  const rating = ratingOf(target);
  const set = (next: 'like' | 'dislike') => {
    const value = rating === next ? null : next;
    const msg = value === 'dislike' ? 'Приховано — повернути можна в «Капсули → Приховані»' : value === 'like' ? 'Подобається — тепер першим' : 'Оцінку знято';
    void act(() => api('POST', `/api/${kind === 'look' ? 'looks' : 'capsules'}/${target.id}/rating`, { rating: value }), msg);
  };
  const ic = size === 'sm' ? 14 : 16;
  return (
    <div className={`rate ${size}`} role="group" aria-label="Оцінка">
      <button className={`rate-btn${rating === 'like' ? ' on' : ''}`} aria-pressed={rating === 'like'} aria-label="Подобається" onClick={(e) => { e.preventDefault(); e.stopPropagation(); set('like'); }}>
        <ThumbsUp size={ic} fill={rating === 'like' ? 'currentColor' : 'none'} />
      </button>
      <button className={`rate-btn${rating === 'dislike' ? ' on' : ''}`} aria-pressed={rating === 'dislike'} aria-label="Не подобається — сховати" onClick={(e) => { e.preventDefault(); e.stopPropagation(); set('dislike'); }}>
        <ThumbsDown size={ic} fill={rating === 'dislike' ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
}

/** Pieces in two blocks: what the owner has, and what to buy. Each tile links to its item or need. */
export function PieceBlocks({ pieces, ownTitle = 'Мої речі' }: { pieces: ResolvedRef[]; ownTitle?: string }) {
  const db = useDb();
  const seen = new Set<string>();
  const unique = pieces.filter((r) => {
    const k = `${r.ref.kind}:${r.ref.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const own = unique.filter((r) => r.kind === 'owned' || r.kind === 'candidate');
  const buy = unique.filter((r) => r.kind === 'need' || r.kind === 'product');
  const tile = (r: ResolvedRef) => (
    <a key={`${r.ref.kind}-${r.ref.id}`} className="wtile" href={r.ref.kind === 'item' ? `/wardrobe/${r.ref.id}` : `/shopping?need=${r.ref.kind === 'need' ? r.ref.id : (db.products.find((p) => p.id === r.ref.id)?.needId ?? '')}`}>
      <div className="img">
        {r.art || r.photo ? <img src={thumb((r.art ?? r.photo)!, 480)} alt={r.title} loading="lazy" /> : <span className="render-ph"><CategoryIcon category={r.category} size={22} /></span>}
        {r.inactive && <span className="tl"><Badge tone="glass">неактуальна</Badge></span>}
      </div>
      <span className="nm">{r.title}<TermInfo texts={[r.title]} /></span>
    </a>
  );
  return (
    <>
      {own.length > 0 && <>
        <div className="section-head"><h2 className="h2">{ownTitle} <span className="count">{own.length}</span></h2></div>
        <div className="ward-grid">{own.map(tile)}</div>
      </>}
      {buy.length > 0 && <>
        <div className="section-head"><h2 className="h2">Докупити <span className="count">{buy.length}</span></h2><a href="/shopping">Список покупок</a></div>
        <div className="ward-grid">{buy.map(tile)}</div>
      </>}
    </>
  );
}
