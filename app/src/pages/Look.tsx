import { useState } from 'react';
import { ImageOff, Pencil, Repeat, Sparkles } from 'lucide-react';
import type { Job, Look } from '../api.ts';
import { api, thumb } from '../api.ts';
import { useApp, useDb } from '../store.tsx';
import { Badge, Empty, PieceBlocks, RateButtons, RenderPlaceholder } from '../components/ui.tsx';
import { REVIEW_LABEL, REVIEW_TONE, capsuleLooks, coverForLook, distinctLooks, piecesOf } from '../lib.ts';
import { hiddenLookIds } from '../rating.ts';
import { EditLook } from './Capsules.tsx';

/**
 * A look is its set of pieces; the try-on is only its current picture. The
 * rating belongs to the look, so it survives a new picture or a swapped piece.
 */
export function LookPage({ id }: { id: string }) {
  const db = useDb();
  const { act, toast } = useApp();
  const [editing, setEditing] = useState(false);
  const look = db.looks.find((l) => l.id === id);
  if (!look) return <div className="page"><Empty icon={<ImageOff />} title="Образ не знайдено" /></div>;
  const capsule = db.capsules.find((c) => c.id === look.capsuleId);
  const isSelection = capsule?.kind === 'selection';
  const cover = coverForLook(db, look);
  const stale = cover && cover.lookVersion !== look.version;
  const hidden = hiddenLookIds(db).has(look.id);
  const siblings = capsule ? distinctLooks(db, capsuleLooks(db, capsule.lookIds)) : [];
  const busy = db.jobs.some((j) => (j.kind ?? 'tryon') === 'tryon' && j.lookId === look.id && (j.state === 'queued' || j.state === 'running'));

  const newPicture = async () => {
    // The server swaps in the pinned identity reference when there is one.
    const job = await act(() => api<Job>('POST', '/api/jobs', { lookId: look.id, basePhotoIds: db.profile.basePhotoIds, instructions: '', run: true }));
    if (!job) return;
    toast(job.state === 'needs_data' ? job.stateNote ?? 'Потрібні дані' : 'Нова картинка в черзі', job.state === 'needs_data');
  };

  return (
    <div className="page">
      <div className="crumb">
        <a href={isSelection ? '#/capsules?tab=selections' : '#/capsules'}>{isSelection ? 'Підбірки' : 'Капсули'}</a>
        {capsule && <><span>›</span><a href={`#/capsules/${capsule.id}`}>{capsule.name}</a></>}
      </div>
      <div className="page-head">
        <div>
          <h1>{look.name}</h1>
          {hidden && <div className="row wrap" style={{ marginTop: 12 }}><Badge>{look.disliked ? 'приховано' : 'схожий на прихований'}</Badge></div>}
        </div>
        <div className="actions">
          <RateButtons kind="look" target={look} />
          <button className="icon-btn" aria-label="Редагувати образ" onClick={() => setEditing(true)}><Pencil size={14} /></button>
        </div>
      </div>

      <div className="look-page">
        <div className="look-hero">
          <a className="cover" href={`#/studio?look=${look.id}${cover ? `&result=${cover.id}` : ''}`}>
            {cover ? <img src={thumb(cover.imagePath, 960)} alt={look.name} /> : <RenderPlaceholder lookIds={[look.id]} />}
            {cover && <span className="corner"><Badge tone={`${REVIEW_TONE[cover.review]} glass`}>{REVIEW_LABEL[cover.review]}</Badge>{stale && <Badge tone="warn glass">склад змінено</Badge>}</span>}
          </a>
          <div className="row">
            <button className="btn" style={{ flex: 1 }} disabled={busy} onClick={() => void newPicture()}><Sparkles size={15} /> {busy ? 'Генерую…' : 'Нова картинка'}</button>
            <a className="btn" style={{ flex: 1 }} href={`#/studio?look=${look.id}`}><Repeat size={15} /> Замінити річ</a>
          </div>
        </div>
        <div className="look-side">
          <PieceBlocks pieces={piecesOf(db, look.slots)} ownTitle="Речі образу" />
          {look.note && <p className="muted" style={{ marginTop: 18 }}>{look.note}</p>}
        </div>
      </div>

      {siblings.length > 1 && (
        <>
          <div className="section-head"><h2 className="h2">Ще в капсулі <span className="count">{siblings.length - 1}</span></h2>{capsule && <a href={`#/capsules/${capsule.id}`}>Уся капсула</a>}</div>
          <div className="sib-strip">
            {siblings.filter((l) => l.id !== look.id).map((l) => <SiblingCard key={l.id} look={l} />)}
          </div>
        </>
      )}
      {editing && <EditLook look={look} onClose={() => setEditing(false)} />}
    </div>
  );
}

function SiblingCard({ look }: { look: Look }) {
  const db = useDb();
  const cover = coverForLook(db, look);
  return (
    <a className="sib" href={`#/looks/${look.id}`}>
      <span className="img">{cover ? <img src={thumb(cover.imagePath, 480)} alt={look.name} loading="lazy" /> : <RenderPlaceholder lookIds={[look.id]} />}</span>
      <span className="nm">{look.favorite && <b className="liked-dot" aria-label="Подобається" />}{look.name}</span>
    </a>
  );
}
