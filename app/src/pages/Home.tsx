import { useRef, useState } from 'react';
import { ArrowRight, Camera, Loader2, Sparkles, TriangleAlert, Wand2 } from 'lucide-react';
import type { Capsule, DB, Job } from '../api.ts';
import { api, thumb, uploadFile } from '../api.ts';
import { go, useApp, useDb } from '../store.tsx';
import { Badge, LookCollage } from '../components/ui.tsx';
import { REVIEW_LABEL, REVIEW_TONE, capsuleCover } from '../lib.ts';

export function CapsuleTile({ c }: { c: Capsule }) {
  const db = useDb();
  const cover = capsuleCover(db, c.lookIds);
  const first = db.looks.find((l) => l.id === c.lookIds[0]);
  return (
    <a href={`#/capsules/${c.id}`} className="capsule-card">
      <div className="cover">
        {cover ? <img src={thumb(cover.imagePath, 900)} alt={c.name} /> : first && <LookCollage slots={first.slots} />}
        {cover && <div className="corner"><Badge tone={`${REVIEW_TONE[cover.review]} glass`}>{REVIEW_LABEL[cover.review]}</Badge></div>}
      </div>
      <div>
        <h3>{c.name}</h3>
        <div className="meta">{c.lookIds.length} образів</div>
      </div>
    </a>
  );
}

/** Starts photo intake: every chosen photo becomes a recognition job. */
export function useIntake() {
  const { act } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = () => input.current?.click();
  const field = (
    <input
      ref={input}
      type="file"
      accept="image/*,.heic,.heif"
      multiple
      hidden
      onChange={async (e) => {
        const files = Array.from(e.target.files ?? []);
        if (!files.length) return;
        setBusy(true);
        await act(async () => {
          for (const f of files) await uploadFile(f, { kind: 'intake' });
        }, files.length > 1 ? `${files.length} фото в обробці` : 'Фото в обробці — речі з’являться в гардеробі');
        setBusy(false);
        if (input.current) input.current.value = '';
      }}
    />
  );
  return { pick, busy, field };
}

function processing(db: DB) {
  return db.jobs
    .filter((j) => (j.kind === 'intake' || j.kind === 'analyze') && (j.state === 'queued' || j.state === 'running' || (j.state === 'error' && !db.jobs.some((x) => x.retryOf === j.id))))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8);
}

function ProcCard({ j }: { j: Job }) {
  const db = useDb();
  const photo = j.inputPhotoIds?.[0] ? db.photos.find((p) => p.id === j.inputPhotoIds![0]) : undefined;
  return (
    <a className="proc-card" href={j.kind === 'analyze' ? '#/capsules?tab=selections' : '#/queue'} title={j.stateNote}>
      <div className="img">
        {photo ? <img src={thumb(photo.path, 300)} alt="" /> : <Wand2 size={26} />}
        <span className="st">
          <Badge tone={j.state === 'error' ? 'bad glass' : 'glass'}>
            {j.state === 'error' ? <TriangleAlert size={11} /> : <Loader2 size={11} className={j.state === 'running' ? 'spin' : ''} />}
            {j.state === 'error' ? 'помилка' : j.state === 'running' ? 'аналіз' : 'черга'}
          </Badge>
        </span>
      </div>
      <span className="t">{j.kind === 'analyze' ? 'Підбірка образів' : 'Розпізнавання речей'}</span>
    </a>
  );
}

export function HomePage() {
  const db = useDb();
  const { act } = useApp();
  const intake = useIntake();
  const [text, setText] = useState('');
  const procs = processing(db);
  const selections = db.capsules.filter((c) => c.kind === 'selection').slice().reverse();
  const capsules = db.capsules.filter((c) => c.kind !== 'selection');
  const analyzing = db.jobs.some((j) => j.kind === 'analyze' && (j.state === 'queued' || j.state === 'running'));
  const pending = db.results.filter((r) => r.review === 'pending');
  const packDone = db.items.filter((i) => i.packshotId).length;
  const packBusy = db.jobs.filter((j) => j.kind === 'packshot' && (j.state === 'queued' || j.state === 'running')).length;

  const analyze = async () => {
    const ok = await act(() => api('POST', '/api/analyze', { prompt: text }), 'Аналізатор складає образи з твоїх речей');
    if (ok) setText('');
  };

  return (
    <div className="page">
      <section className="home-hero">
        <h1>Що одягнемо сьогодні?</h1>
        <div className="prompt-box">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Куди? Напр.: вихідні в місті, вечеря, офіс" />
        </div>
        <div className="big-actions">
          <button className="big-action" onClick={intake.pick} disabled={intake.busy}>
            {intake.busy ? <Loader2 size={20} className="spin" /> : <Camera size={20} />} Фото одягу
          </button>
          <button className="big-action primary" onClick={() => void analyze()} disabled={analyzing}>
            {analyzing ? <Loader2 size={20} className="spin" /> : <Sparkles size={20} />} {analyzing ? 'Підбираю…' : 'Підібрати образи'}
          </button>
        </div>
        {intake.field}
        {(pending.length > 0 || packBusy > 0) && (
          <div className="suggest">
            {pending.length > 0 && (
              <a className="pill" href={`#/studio?look=${pending[0].lookId}&result=${pending[0].id}`}>
                <span className="pi"><img src={thumb(pending[0].imagePath, 80)} alt="" /></span>
                Перевірити примірку
              </a>
            )}
            {packBusy > 0 && (
              <a className="pill" href="#/wardrobe">
                <span className="pi"><Loader2 size={13} className="spin" /></span>
                Packshot {packDone}/{db.items.length}
              </a>
            )}
          </div>
        )}
      </section>

      {procs.length > 0 && (
        <>
          <div className="section-head"><h2 className="h2">В обробці</h2><a href="#/queue">Черга <ArrowRight size={13} style={{ verticalAlign: '-2px' }} /></a></div>
          <div className="proc">{procs.map((j) => <ProcCard key={j.id} j={j} />)}</div>
        </>
      )}

      {selections.length > 0 && (
        <>
          <div className="section-head"><h2 className="h2">Підбірки з моїх речей</h2><a href="#/capsules?tab=selections">Усі <ArrowRight size={13} style={{ verticalAlign: '-2px' }} /></a></div>
          <div className="capsule-grid">{selections.slice(0, 3).map((c) => <CapsuleTile key={c.id} c={c} />)}</div>
        </>
      )}

      <div className="section-head"><h2 className="h2">Капсули</h2><a href="#/capsules" onClick={() => go('/capsules')}>Усі <ArrowRight size={13} style={{ verticalAlign: '-2px' }} /></a></div>
      <div className="capsule-grid">{capsules.map((c) => <CapsuleTile key={c.id} c={c} />)}</div>
    </div>
  );
}
