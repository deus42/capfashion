import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, Footprints, ImagePlus, Layers, Loader2, Shirt, Upload, Watch, X } from 'lucide-react';
import type { Category, Photo, PhotoKind, Slots } from '../api.ts';
import { thumb, uploadFile } from '../api.ts';
import { useApp, useDb } from '../store.tsx';
import type { ResolvedRef } from '../lib.ts';
import { REF_KIND_LABEL, piecesOf } from '../lib.ts';

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

export function Drawer({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <Overlay onClose={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрити">
            <X size={16} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
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
