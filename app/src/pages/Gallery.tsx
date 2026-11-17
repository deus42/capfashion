import { useMemo, useState } from 'react';
import { Download, ExternalLink, Images, RotateCcw, ThumbsUp, Trash2, X } from 'lucide-react';
import type { DB, Photo, Result } from '../api.ts';
import { api, media, thumb } from '../api.ts';
import { useApp, useDb, useRoute } from '../store.tsx';
import { Badge, ConfirmButton, Empty, Overlay, PageHead, RateButtons } from '../components/ui.tsx';
import { hiddenLookIds } from '../rating.ts';
import './Gallery.css';

type Entry = { kind: 'tryon'; r: Result; at: string } | { kind: 'packshot' | 'inspiration' | 'original'; p: Photo; at: string; itemId?: string };

function entries(db: DB): Entry[] {
  const hidden = hiddenLookIds(db);
  const out: Entry[] = db.results.filter((r) => !hidden.has(r.lookId)).map((r) => ({ kind: 'tryon' as const, r, at: r.createdAt }));
  for (const p of db.photos) {
    if (p.inspiration) {
      out.push({ kind: 'inspiration', p, at: p.createdAt });
      continue;
    }
    if (p.source !== 'generated') {
      out.push({ kind: 'original', p, at: p.createdAt });
      continue;
    }
    if (p.kind !== 'packshot') continue;
    // Only the current photo of an item in use: no superseded or orphaned duplicates.
    const item = db.items.find((i) => i.packshotId === p.id && i.status !== 'inactive' && !i.mergedInto);
    if (!item) continue;
    out.push({ kind: 'packshot', p, at: p.createdAt, itemId: item.id });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
}

function Lightbox({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const db = useDb();
  const { act } = useApp();
  if (entry.kind === 'tryon') {
    // A try-on in the archive: the picture, the look's rating and the way to the look (its check lives on the look page).
    const r = db.results.find((x) => x.id === entry.r.id);
    if (!r) return null;
    const look = db.looks.find((l) => l.id === r.lookId);
    return (
      <Overlay onClose={onClose}>
        <div className="lightbox simple" role="dialog" aria-modal="true">
          <div className="lb-img"><img src={media(r.imagePath)} alt={look?.name} /></div>
          <div className="lb-bar">
            {look ? <a className="grow lb-name" href={`/looks/${look.id}`} onClick={onClose}>{look.name}</a> : <b className="grow">Примірка</b>}
            {look && <RateButtons kind="look" target={look} size="sm" />}
            <button className="icon-btn" onClick={onClose} aria-label="Закрити"><X size={16} /></button>
          </div>
        </div>
      </Overlay>
    );
  }
  const item = entry.itemId ? db.items.find((i) => i.id === entry.itemId) : undefined;
  const job = db.jobs.find((j) => j.photoId === entry.p.id);
  const inspiration = entry.p.inspiration;
  const original = entry.kind === 'original';
  const title = inspiration?.title ?? item?.title ?? (original ? 'Моє фото' : 'Фото');
  return (
    <Overlay onClose={onClose}>
      <div className={`lightbox${inspiration || original ? ' inspiration-lightbox' : ''}`} role="dialog" aria-modal="true">
        <div className="lb-img" style={{ background: '#fff' }}><img src={media(entry.p.path)} alt={title} /></div>
        <div className="lb-side">
          <div className="drawer-head">
            <h2>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Закрити"><X size={16} /></button>
          </div>
          <div className="body">
            {inspiration?.sourceNote && <div className="note small">{inspiration.sourceNote}</div>}
            {inspiration && <div className="row wrap">{inspiration.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>}
          </div>
          <div className="drawer-foot">
            {!original && <ConfirmButton className="btn sm ghost danger" title={inspiration ? 'Прибрати референс' : 'Видалити фото речі'} message={inspiration ? 'Прибрати цей референс із галереї? Архівне джерело залишиться.' : 'Видалити це згенероване фото? Річ і її оригінальні фото залишаться.'} onConfirm={async () => { const ok = await act(() => api('DELETE', `/api/photos/${entry.p.id}`), 'Зображення прибрано'); if (ok !== undefined) onClose(); }}>
              <Trash2 size={13} />
            </ConfirmButton>}
            <span style={{ flex: 1 }} />
            {inspiration && <a className="btn sm" href={inspiration.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Джерело</a>}
            {original && <a className="btn sm" href={media(entry.p.originalPath ?? entry.p.path)} download><Download size={13} /> Оригінал</a>}
            {!original && job && (
              <button className="btn sm" onClick={() => void act(() => api('POST', `/api/jobs/${job.id}/retry`, { run: true }), 'Роблю нове фото речі')}>
                <RotateCcw size={13} /> Нове фото
              </button>
            )}
            {item && <a className="btn sm primary" href={`/wardrobe/${item.id}`} onClick={onClose}>Картка речі</a>}
          </div>
        </div>
      </div>
    </Overlay>
  );
}

export function GalleryPage() {
  const db = useDb();
  const { query } = useRoute();
  const [type, setType] = useState<'tryon' | 'packshot' | 'inspiration' | 'original' | 'face'>(query.get('type') === 'face' ? 'face' : query.get('type') === 'original' ? 'original' : query.get('type') === 'inspiration' ? 'inspiration' : query.get('type') === 'packshot' ? 'packshot' : 'tryon');
  const [tag, setTag] = useState('');
  const [filter, setFilter] = useState<'any' | 'fav'>('any');
  const [open, setOpen] = useState<Entry | null>(null);
  const all = useMemo(() => entries(db), [db]);
  const tags = [...new Set(all.flatMap((e) => e.kind === 'inspiration' ? e.p.inspiration?.tags ?? [] : []))].sort();
  const list = all.filter((e) => {
    if (type === 'face') return e.kind === 'original' && e.p.referenceRole === 'face';
    if (e.kind !== type) return false;
    if (type === 'inspiration' && tag && !(e.kind === 'inspiration' && e.p.inspiration?.tags.includes(tag))) return false;
    if (type === 'inspiration' || type === 'original') return true;
    if (filter === 'any') return true;
    if (e.kind !== 'tryon') return false;
    if (filter === 'fav') return Boolean(db.looks.find((l) => l.id === e.r.lookId)?.favorite);
    return true;
  });
  const groups: [string, Entry[]][] = [];
  for (const e of list) {
    const k = dayKey(e.at);
    const g = groups.find((x) => x[0] === k);
    if (g) g[1].push(e);
    else groups.push([k, [e]]);
  }
  const counts = { tryon: all.filter((e) => e.kind === 'tryon').length, packshot: all.filter((e) => e.kind === 'packshot').length, inspiration: all.filter((e) => e.kind === 'inspiration').length, original: all.filter((e) => e.kind === 'original').length, face: all.filter((e) => e.kind === 'original' && e.p.referenceRole === 'face').length };

  return (
    <div className="page">
      <PageHead title="Галерея" />
      <div className="toolbar">
        <div className="seg" style={{ flexWrap: 'wrap', maxWidth: '100%' }}>
          <button className={type === 'tryon' ? 'on' : ''} onClick={() => setType('tryon')}>Примірки <span className="faint">{counts.tryon}</span></button>
          <button className={type === 'packshot' ? 'on' : ''} onClick={() => setType('packshot')}>Фото речей <span className="faint">{counts.packshot}</span></button>
          <button className={type === 'original' ? 'on' : ''} onClick={() => setType('original')}>Мої фото <span className="faint">{counts.original}</span></button>
          <button className={type === 'face' ? 'on' : ''} onClick={() => setType('face')}>Обличчя <span className="faint">{counts.face}</span></button>
          <button className={type === 'inspiration' ? 'on' : ''} onClick={() => setType('inspiration')}>Натхнення <span className="faint">{counts.inspiration}</span></button>
        </div>
        <span className="grow" />
        {type === 'inspiration' && (
          <div className="chips" role="group" aria-label="Тема натхнення">
            <button className={`chip${tag === '' ? ' active' : ''}`} onClick={() => setTag('')}>Усі теми</button>
            {tags.map((t) => <button key={t} className={`chip${tag === t ? ' active' : ''}`} onClick={() => setTag(t)}>{t}</button>)}
          </div>
        )}
        {type === 'tryon' && (
          <div className="chips">
            {(
              [
                ['any', 'Усі'],
                ['fav', <ThumbsUp key="fav" size={14} aria-label="Подобаються" />],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className={`chip${filter === k ? ' active' : ''}`} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
        )}
      </div>
      {groups.length === 0 ? (
        <Empty icon={<Images />} title="Поки порожньо" />
      ) : (
        groups.map(([day, es]) => (
          <section key={day}>
            <div className="eyebrow">{day}</div>
            <div className="gallery">
              {es.map((e) =>
                e.kind === 'tryon' ? (
                  <button key={e.r.id} className="gtile" onClick={() => setOpen(e)}>
                    <img src={thumb(e.r.imagePath, 520)} alt="" loading="lazy" style={{ objectPosition: 'top' }} />
                    {db.looks.find((l) => l.id === e.r.lookId)?.favorite && <span className="tr liked-mark" aria-label="Подобається"><ThumbsUp size={12} fill="currentColor" /></span>}
                    <span className="cap">{db.looks.find((l) => l.id === e.r.lookId)?.name}</span>
                  </button>
                ) : (
                  <button key={e.p.id} className="gtile contain" onClick={() => setOpen(e)}>
                    <img src={thumb(e.p.path, 520)} alt={e.p.inspiration?.title ?? ''} loading="lazy" />
                    <span className="cap">{e.p.inspiration?.title ?? db.items.find((i) => i.id === e.itemId)?.title ?? e.p.originalName}</span>
                  </button>
                ),
              )}
            </div>
          </section>
        ))
      )}
      {open && <Lightbox entry={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
