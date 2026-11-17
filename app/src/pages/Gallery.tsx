import { useMemo, useState } from 'react';
import { Download, ExternalLink, Images, RotateCcw, ThumbsUp, Trash2, X } from 'lucide-react';
import type { DB, Photo, Result } from '../api.ts';
import { api, media, thumb } from '../api.ts';
import { useApp, useDb, useRoute } from '../store.tsx';
import { Badge, ConfirmButton, Empty, Overlay, PageHead, RateButtons } from '../components/ui.tsx';
import { hiddenLookIds } from '../rating.ts';
import { REVIEW_LABEL, REVIEW_TONE, fmtDate } from '../lib.ts';
import { Composition, ReviewBar, compositionFor } from './Studio.tsx';
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
    const item = db.items.find((i) => i.packshotId === p.id);
    out.push({ kind: 'packshot', p, at: p.createdAt, itemId: item?.id });
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
    const r = db.results.find((x) => x.id === entry.r.id);
    if (!r) return null;
    const look = db.looks.find((l) => l.id === r.lookId);
    const comp = look ? compositionFor(db, r, look) : null;
    return (
      <Overlay onClose={onClose}>
        <div className="lightbox" role="dialog" aria-modal="true">
          <div className="lb-img"><img src={media(r.imagePath)} alt={look?.name} /></div>
          <div className="lb-side">
            <div className="drawer-head">
              <h2>{look?.name ?? 'Примірка'}</h2>
              <button className="icon-btn" onClick={onClose} aria-label="Закрити"><X size={16} /></button>
            </div>
            <div className="body">
              <div className="row wrap">
                <Badge tone={REVIEW_TONE[r.review]}>{REVIEW_LABEL[r.review]}</Badge>
                <Badge>v{r.lookVersion}</Badge>
                <span className="small faint">{fmtDate(r.createdAt)}</span>
              </div>
              {comp && <Composition lines={comp.lines} version={comp.version} title="Склад" />}
              <ReviewBar result={r} />
              {r.notes && <div className="note small">{r.notes}</div>}
              <div className="small faint">{r.tool} · {r.model}</div>
            </div>
            <div className="drawer-foot">
              <ConfirmButton className="btn sm ghost danger" title="Видалити примірку" message="Видалити це зображення примірки? Образ і речі залишаться." onConfirm={async () => { const ok = await act(() => api('DELETE', `/api/results/${r.id}`), 'Примірку видалено'); if (ok !== undefined) onClose(); }}>
                <Trash2 size={13} />
              </ConfirmButton>
              <span style={{ flex: 1 }} />
              {look && <RateButtons kind="look" target={look} size="sm" />}
              {look && <a className="btn sm" href={`/looks/${look.id}`} onClick={onClose}>Образ</a>}
              <a className="btn sm" href={media(r.imagePath)} download><Download size={13} /> Завантажити</a>
            </div>
          </div>
        </div>
      </Overlay>
    );
  }
  const item = entry.itemId ? db.items.find((i) => i.id === entry.itemId) : undefined;
  const job = db.jobs.find((j) => j.photoId === entry.p.id);
  const inspiration = entry.p.inspiration;
  const original = entry.kind === 'original';
  const title = inspiration?.title ?? item?.title ?? entry.p.originalName;
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
            <div className="row wrap">
              <Badge tone="info">{original ? 'Оригінал · референс' : inspiration ? 'Натхнення' : 'Packshot'}</Badge>
              {!original && !inspiration && <Badge>реконструкція</Badge>}
              <span className="small faint">{fmtDate(entry.p.createdAt)}</span>
            </div>
            <div className="note small">{original ? entry.p.referenceRole === 'face' ? `Оригінальний референс обличчя, окремо від фото статури й генерацій. ${entry.p.note ?? ''}` : 'Твоє оригінальне фото. Зберігається як референс окремо від згенерованих примірок. Вибір для конкретної генерації не прибирає інші оригінали.' : inspiration?.sourceNote ?? entry.p.note ?? 'Генеративна реконструкція.'}</div>
            {inspiration && <div className="row wrap">{inspiration.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>}
          </div>
          <div className="drawer-foot">
            {!original && <ConfirmButton className="btn sm ghost danger" title={inspiration ? 'Прибрати референс' : 'Видалити packshot'} message={inspiration ? 'Прибрати цей референс із галереї? Архівне джерело залишиться.' : 'Видалити це згенероване фото? Річ і її оригінальні фото залишаться.'} onConfirm={async () => { const ok = await act(() => api('DELETE', `/api/photos/${entry.p.id}`), 'Зображення прибрано'); if (ok !== undefined) onClose(); }}>
              <Trash2 size={13} />
            </ConfirmButton>}
            <span style={{ flex: 1 }} />
            {inspiration && <a className="btn sm" href={inspiration.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Джерело</a>}
            {original && <a className="btn sm" href={media(entry.p.originalPath ?? entry.p.path)} download><Download size={13} /> Оригінал</a>}
            {!original && job && (
              <button className="btn sm" onClick={() => void act(() => api('POST', `/api/jobs/${job.id}/retry`, { run: true }), 'Новий packshot у роботі')}>
                <RotateCcw size={13} /> Перегенерувати
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
  const [type, setType] = useState<'all' | 'tryon' | 'packshot' | 'inspiration' | 'original' | 'face'>(query.get('type') === 'face' ? 'face' : query.get('type') === 'original' ? 'original' : query.get('type') === 'inspiration' ? 'inspiration' : 'all');
  const [tag, setTag] = useState('');
  const [filter, setFilter] = useState<'any' | 'pending' | 'accepted' | 'fav'>('any');
  const [open, setOpen] = useState<Entry | null>(null);
  const all = useMemo(() => entries(db), [db]);
  const tags = [...new Set(all.flatMap((e) => e.kind === 'inspiration' ? e.p.inspiration?.tags ?? [] : []))].sort();
  const list = all.filter((e) => {
    if (type === 'face') return e.kind === 'original' && e.p.referenceRole === 'face';
    if (type === 'all' && (e.kind === 'original' || e.kind === 'inspiration')) return false;
    if (type !== 'all' && e.kind !== type) return false;
    if (type === 'inspiration' && tag && !(e.kind === 'inspiration' && e.p.inspiration?.tags.includes(tag))) return false;
    if (type === 'inspiration' || type === 'original') return true;
    if (filter === 'any') return true;
    if (e.kind !== 'tryon') return false;
    if (filter === 'fav') return Boolean(db.looks.find((l) => l.id === e.r.lookId)?.favorite);
    return e.r.review === filter;
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
          <button className={type === 'all' ? 'on' : ''} onClick={() => setType('all')}>Згенероване <span className="faint">{counts.tryon + counts.packshot}</span></button>
          <button className={type === 'original' ? 'on' : ''} onClick={() => setType('original')}>Мої фото <span className="faint">{counts.original}</span></button>
          <button className={type === 'face' ? 'on' : ''} onClick={() => setType('face')}>Обличчя <span className="faint">{counts.face}</span></button>
          <button className={type === 'tryon' ? 'on' : ''} onClick={() => setType('tryon')}>Примірки <span className="faint">{counts.tryon}</span></button>
          <button className={type === 'packshot' ? 'on' : ''} onClick={() => setType('packshot')}>Packshot <span className="faint">{counts.packshot}</span></button>
          <button className={type === 'inspiration' ? 'on' : ''} onClick={() => setType('inspiration')}>Натхнення <span className="faint">{counts.inspiration}</span></button>
        </div>
        <span className="grow" />
        {type === 'inspiration' && (
          <div className="chips" role="group" aria-label="Тема натхнення">
            <button className={`chip${tag === '' ? ' active' : ''}`} onClick={() => setTag('')}>Усі теми</button>
            {tags.map((t) => <button key={t} className={`chip${tag === t ? ' active' : ''}`} onClick={() => setTag(t)}>{t}</button>)}
          </div>
        )}
        {type !== 'packshot' && type !== 'inspiration' && type !== 'original' && type !== 'face' && (
          <div className="chips">
            {(
              [
                ['any', 'Усі'],
                ['pending', 'На перевірці'],
                ['accepted', 'Прийняті'],
                ['fav', 'Подобаються'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className={`chip${filter === k ? ' active' : ''}`} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
        )}
      </div>
      {groups.length === 0 ? (
        <Empty icon={<Images />} title="Поки порожньо">Згенеруй примірку або packshot — вони з’являться тут.</Empty>
      ) : (
        groups.map(([day, es]) => (
          <section key={day}>
            <div className="eyebrow">{day}</div>
            <div className="gallery">
              {es.map((e) =>
                e.kind === 'tryon' ? (
                  <button key={e.r.id} className="gtile" onClick={() => setOpen(e)}>
                    <img src={thumb(e.r.imagePath, 520)} alt="" loading="lazy" style={{ objectPosition: 'top' }} />
                    <span className="tl"><Badge tone={`${REVIEW_TONE[e.r.review]} glass`}>{REVIEW_LABEL[e.r.review]}</Badge></span>
                    {db.looks.find((l) => l.id === e.r.lookId)?.favorite && <span className="tr liked-mark" aria-label="Подобається"><ThumbsUp size={12} fill="currentColor" /></span>}
                    <span className="cap">{db.looks.find((l) => l.id === e.r.lookId)?.name}</span>
                  </button>
                ) : (
                  <button key={e.p.id} className="gtile contain" onClick={() => setOpen(e)}>
                    <img src={thumb(e.p.path, 520)} alt={e.p.inspiration?.title ?? ''} loading="lazy" />
                    {e.kind === 'inspiration' && <span className="tl"><Badge tone="glass">Натхнення</Badge></span>}
                    {e.kind === 'original' && <span className="tl"><Badge tone="glass">{e.p.referenceRole === 'face' ? 'Обличчя · оригінал' : 'Оригінал'}</Badge></span>}
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
