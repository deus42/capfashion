import { useState } from 'react';
import { ArrowRight, CircleCheck, ImagePlus, Inbox, Play, ShoppingBag, Sparkles, User, Wand2 } from 'lucide-react';
import type { Job } from '../api.ts';
import { api, thumb } from '../api.ts';
import { go, useApp, useDb } from '../store.tsx';
import { Badge, LookCollage, UploadButton } from '../components/ui.tsx';
import { REVIEW_LABEL, REVIEW_TONE, SEASON_LABEL, capsuleCover, looksUsing } from '../lib.ts';

function greeting() {
  const h = new Date().getHours();
  if (h < 11) return 'Доброго ранку';
  if (h < 18) return 'Добрий день';
  return 'Добрий вечір';
}

export function HomePage() {
  const db = useDb();
  const { act, toast } = useApp();
  const [lookId, setLookId] = useState('L-urban-1');
  const [text, setText] = useState('');
  const pending = db.results.filter((r) => r.review === 'pending');
  const toConfirm = db.items.filter((i) => i.status === 'needs_confirmation').length;
  const packshots = db.items.filter((i) => i.packshotId).length;
  const packshotJobs = db.jobs.filter((j) => j.kind === 'packshot' && (j.state === 'queued' || j.state === 'running')).length;
  const okBase = db.profile.basePhotoIds.filter((id) => db.photos.find((p) => p.id === id)?.meetsStandard).length;
  const latest = db.results.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const packshotSample = db.items.map((i) => (i.packshotId ? db.photos.find((p) => p.id === i.packshotId) : undefined)).find(Boolean);
  const openNeeds = db.needs.filter((n) => n.status === 'open' && looksUsing(db, 'need', n.id).length > 0).length;
  const urban = db.looks.find((l) => l.id === 'L-urban-1') ?? db.looks[0];
  const ref = db.looks.find((l) => l.id === 'L-ref-1') ?? db.looks[0];

  const generate = async () => {
    const job = await act(() => api<Job>('POST', '/api/jobs', { lookId, instructions: text, run: true }));
    if (!job) return;
    if (job.state === 'needs_data') {
      toast(`Потрібні дані: ${job.stateNote ?? ''}`, true);
      go('/profile/base');
      return;
    }
    toast('Запущено — Codex генерує примірку');
    go(`/studio?look=${lookId}`);
  };

  return (
    <div className="page">
      <section className="home-hero">
        <h1>Що одягнемо сьогодні?</h1>
        <p className="sub">{greeting()}. Твої капсули, речі й примірки — в одному місці, без чатів.</p>
        <div className="prompt-box">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Що врахувати в примірці? Напр.: сорочку навипуск, рукави закочені" />
          <div className="bar">
            <select className="select sm" style={{ width: 'auto', maxWidth: 260 }} value={lookId} onChange={(e) => setLookId(e.target.value)} aria-label="Образ">
              {db.capsules.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  {c.lookIds.map((id) => {
                    const l = db.looks.find((x) => x.id === id);
                    return l ? <option key={l.id} value={l.id}>{l.name}</option> : null;
                  })}
                </optgroup>
              ))}
            </select>
            <UploadButton kind="base" className="btn sm" label="Базові фото" onDone={() => go('/profile/base')} />
            <span className="grow" />
            <button className="btn primary sm" onClick={() => void generate()}>
              <Wand2 size={14} /> Згенерувати
            </button>
          </div>
        </div>
        <div className="suggest">
          {pending.length > 0 && (
            <a className="pill" href={`#/studio?look=${pending[0].lookId}&result=${pending[0].id}`}>
              <span className="pi"><img src={thumb(pending[0].imagePath, 80)} alt="" /></span>
              Переглянути примірку ({pending.length})
            </a>
          )}
          <a className="pill" href="#/wardrobe">
            <span className="pi">{packshotSample ? <img src={thumb(packshotSample.path, 80)} alt="" /> : <CircleCheck size={14} />}</span>
            Підтвердити речі ({toConfirm})
          </a>
          <a className="pill" href="#/profile/base">
            <span className="pi"><User size={14} /></span>
            Додати базові фото
          </a>
          <a className="pill" href="#/shopping">
            <span className="pi"><ShoppingBag size={14} /></span>
            Що докупити ({openNeeds})
          </a>
        </div>
      </section>

      <div className="section-head">
        <h2 className="h2">Швидкі дії</h2>
      </div>
      <div className="shortcuts">
        <a className="shortcut" href="#/studio">
          {latest ? <img src={thumb(latest.imagePath, 700)} alt="" style={{ objectPosition: 'top' }} /> : urban && <LookCollage slots={urban.slots} />}
          <span className="lbl"><Sparkles size={14} /> Примірка</span>
          <span className="desc">Побач себе в образі на білому фоні — через локальний Codex</span>
        </a>
        <a className="shortcut" href="#/wardrobe">
          {packshotSample ? <img src={thumb(packshotSample.path, 700)} alt="" style={{ objectFit: 'contain', background: '#fff', padding: 18 }} /> : null}
          <span className="lbl"><ImagePlus size={14} /> Гардероб</span>
          <span className="desc">Твої речі як чисті packshot-фото; підтверди, що справді маєш</span>
        </a>
        <a className="shortcut" href="#/capsules">
          {ref && <LookCollage slots={ref.slots} />}
          <span className="lbl"><Play size={14} /> Капсули</span>
          <span className="desc">Urban, Mediterranean і Refined — 13 образів</span>
        </a>
        <a className="shortcut" href="#/shopping">
          {urban && <LookCollage slots={db.looks.find((l) => l.id === 'L-med-1')?.slots ?? urban.slots} />}
          <span className="lbl"><ShoppingBag size={14} /> Покупки</span>
          <span className="desc">Одна потреба на всі капсули; товари з Tower Center Rijeka</span>
        </a>
      </div>

      <div className="section-head">
        <h2 className="h2">Потребує уваги</h2>
      </div>
      <div className="attention">
        <a className="attn" href={pending[0] ? `#/studio?look=${pending[0].lookId}&result=${pending[0].id}` : '#/studio'}>
          <span className="ic"><Sparkles size={18} /></span>
          <div><b>{pending.length}</b><span>примірок на перевірці</span></div>
        </a>
        <a className="attn" href="#/wardrobe">
          <span className="ic"><CircleCheck size={18} /></span>
          <div><b>{toConfirm}</b><span>речей чекають підтвердження</span></div>
        </a>
        <a className="attn" href="#/profile/base">
          <span className="ic"><User size={18} /></span>
          <div><b>{okBase}/2</b><span>базових фото за стандартом</span></div>
        </a>
        <a className="attn" href="#/queue">
          <span className="ic"><Inbox size={18} /></span>
          <div><b>{packshots}/{db.items.length}</b><span>packshot готово{packshotJobs ? ` · ${packshotJobs} у черзі` : ''}</span></div>
        </a>
      </div>

      <div className="section-head">
        <h2 className="h2">Капсули</h2>
        <a href="#/capsules">Усі капсули <ArrowRight size={13} style={{ verticalAlign: '-2px' }} /></a>
      </div>
      <div className="capsule-grid">
        {db.capsules.map((c) => {
          const cover = capsuleCover(db, c.lookIds);
          const first = db.looks.find((l) => l.id === c.lookIds[0]);
          return (
            <a key={c.id} href={`#/capsules/${c.id}`} className="capsule-card">
              <div className="cover">
                {cover ? <img src={thumb(cover.imagePath, 900)} alt={c.name} /> : first && <LookCollage slots={first.slots} />}
                {cover && (
                  <div className="corner">
                    <Badge tone={REVIEW_TONE[cover.review]}>{REVIEW_LABEL[cover.review]}</Badge>
                  </div>
                )}
              </div>
              <div>
                <h3>{c.name}</h3>
                <div className="meta">
                  <span>{SEASON_LABEL[c.season]}</span>·<span>{c.lookIds.length} образів</span>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
