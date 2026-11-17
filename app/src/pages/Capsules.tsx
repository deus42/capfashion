import { useMemo, useState } from 'react';
import { Heart, ImageOff, Loader2, Pencil, Plus, ShoppingBag, Sparkles, Trash2 } from 'lucide-react';
import type { Capsule, Look, Season } from '../api.ts';
import { api, thumb } from '../api.ts';
import { go, useApp, useDb, useRoute } from '../store.tsx';
import { Badge, CategoryIcon, ConfirmButton, Empty, Modal, RenderPlaceholder } from '../components/ui.tsx';
import { REF_KIND_LABEL, REVIEW_LABEL, REVIEW_TONE, SEASON_LABEL, coverForLook, piecesOf } from '../lib.ts';
import { CapsuleTile } from './Home.tsx';

function AnalyzeBox() {
  const db = useDb();
  const { act } = useApp();
  const [text, setText] = useState('');
  const job = db.jobs.filter((j) => j.kind === 'analyze').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const busy = job && (job.state === 'queued' || job.state === 'running');
  return (
    <div className="prompt-box" style={{ maxWidth: 'none', marginBottom: 26 }}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Підбери образи з моїх речей… Напр.: на вихідні, у прохолодну погоду" />
      <div className="bar">
        {job?.state === 'error' && <span className="small" style={{ color: 'var(--bad)' }}>{job.stateNote}</span>}
        <span className="grow" />
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            const ok = await act(() => api('POST', '/api/analyze', { prompt: text }), 'Аналізатор складає образи');
            if (ok) setText('');
          }}
        >
          {busy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} {busy ? 'Підбираю…' : 'Підібрати'}
        </button>
      </div>
    </div>
  );
}

export function CapsulesPage() {
  const db = useDb();
  const { query } = useRoute();
  const [tab, setTab] = useState<'capsules' | 'selections'>(query.get('tab') === 'selections' ? 'selections' : 'capsules');
  const capsules = db.capsules.filter((c) => c.kind !== 'selection');
  const selections = db.capsules.filter((c) => c.kind === 'selection').slice().reverse();
  const list = tab === 'capsules' ? capsules : selections;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{tab === 'capsules' ? 'Капсули' : 'Підбірки'}</h1></div>
        <div className="actions">
          <div className="seg">
            <button className={tab === 'capsules' ? 'on' : ''} onClick={() => setTab('capsules')}>Капсули <span className="faint">{capsules.length}</span></button>
            <button className={tab === 'selections' ? 'on' : ''} onClick={() => setTab('selections')}>З моїх речей <span className="faint">{selections.length}</span></button>
          </div>
        </div>
      </div>
      {tab === 'selections' && <AnalyzeBox />}
      {list.length === 0 ? (
        <Empty icon={<Sparkles />} title="Підбірок ще немає">Напиши, куди збираєшся, і натисни «Підібрати» — образи складуться лише з твоїх речей.</Empty>
      ) : (
        <div className="capsule-grid">{list.map((c) => <CapsuleTile key={c.id} c={c} />)}</div>
      )}
    </div>
  );
}

function EditLook({ look, onClose }: { look: Look; onClose: () => void }) {
  const db = useDb();
  const { act } = useApp();
  const [name, setName] = useState(look.name);
  const [note, setNote] = useState(look.note ?? '');
  const renders = db.results.filter((r) => r.lookId === look.id).length;
  return (
    <Modal
      title="Образ"
      onClose={onClose}
      footer={
        <>
          <ConfirmButton
            className="btn danger"
            title="Видалити образ"
            message={<>Видалити «{look.name}»?{renders ? ` Разом з ним зникнуть ${renders} примірок цього образу.` : ''} Речі в гардеробі залишаться.</>}
            onConfirm={async () => {
              const ok = await act(() => api('DELETE', `/api/looks/${look.id}`), 'Образ видалено');
              if (ok !== undefined) onClose();
            }}
          >
            <Trash2 size={15} /> Видалити
          </ConfirmButton>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Скасувати</button>
          <button
            className="btn primary"
            onClick={async () => {
              const ok = await act(() => api('PATCH', `/api/looks/${look.id}`, { rev: look.rev, name, note }), 'Збережено');
              if (ok) onClose();
            }}
          >
            Зберегти
          </button>
        </>
      }
    >
      <div className="grid-form">
        <label className="field full"><span>Назва</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field full"><span>Нотатка</span><textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <a className="btn" style={{ marginTop: 16 }} href={`#/studio?look=${look.id}`} onClick={onClose}><Sparkles size={15} /> Змінити склад у примірці</a>
    </Modal>
  );
}

function LookCard({ look }: { look: Look }) {
  const db = useDb();
  const [editing, setEditing] = useState(false);
  const cover = coverForLook(db, look);
  const stale = cover && cover.lookVersion !== look.version;
  return (
    <div className="look-card">
      <a className="cover" href={`#/studio?look=${look.id}`}>
        {cover ? <img src={thumb(cover.imagePath, 700)} alt={look.name} /> : <RenderPlaceholder lookIds={[look.id]} />}
        <div className="corner">
          {cover && <Badge tone={`${REVIEW_TONE[cover.review]} glass`}>{REVIEW_LABEL[cover.review]}</Badge>}
          {stale && <Badge tone="warn">склад змінено</Badge>}
        </div>
        <span className="go btn sm primary"><Sparkles size={13} /> {cover ? 'Відкрити' : 'Приміряти'}</span>
      </a>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h4 title={look.note}>{look.name}</h4>
        <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => setEditing(true)} aria-label="Редагувати образ"><Pencil size={13} /></button>
      </div>
      {editing && <EditLook look={look} onClose={() => setEditing(false)} />}
    </div>
  );
}

function EditCapsule({ capsule, onClose }: { capsule: Capsule; onClose: () => void }) {
  const { act } = useApp();
  const [name, setName] = useState(capsule.name);
  const [description, setDescription] = useState(capsule.description);
  const [season, setSeason] = useState<Season>(capsule.season);
  const [situations, setSituations] = useState(capsule.situations.join('\n'));
  const save = async () => {
    const ok = await act(() => api('PATCH', `/api/capsules/${capsule.id}`, { rev: capsule.rev, name, description, season, situations: situations.split('\n') }), 'Збережено');
    if (ok) onClose();
  };
  return (
    <Modal title="Редагувати" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Скасувати</button><button className="btn primary" onClick={() => void save()}>Зберегти</button></>}>
      <div className="grid-form">
        <label className="field full"><span>Назва</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field full"><span>Опис</span><textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <label className="field">
          <span>Сезон</span>
          <select className="select" value={season} onChange={(e) => setSeason(e.target.value as Season)}>
            {(['all', 'warm', 'transitional', 'cold'] as Season[]).map((s) => <option key={s} value={s}>{SEASON_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="field full"><span>Ситуації (по рядку)</span><textarea className="textarea" value={situations} onChange={(e) => setSituations(e.target.value)} /></label>
      </div>
    </Modal>
  );
}

export function CapsuleDetail({ id }: { id: string }) {
  const db = useDb();
  const { act } = useApp();
  const [editing, setEditing] = useState(false);
  const capsule = db.capsules.find((c) => c.id === id);
  const looks = useMemo(() => (capsule?.lookIds ?? []).map((l) => db.looks.find((x) => x.id === l)).filter((l): l is Look => Boolean(l)), [capsule, db.looks]);
  if (!capsule) return <div className="page"><Empty icon={<ImageOff />} title="Не знайдено" /></div>;

  const pieces = new Map<string, ReturnType<typeof piecesOf>[number]>();
  for (const l of looks) for (const r of piecesOf(db, l.slots)) pieces.set(`${r.ref.kind}:${r.ref.id}`, r);
  const needs = [...pieces.values()].filter((r) => r.kind === 'need' || r.kind === 'product');
  const isSelection = capsule.kind === 'selection';

  const addLook = async () => {
    const look = await act(() => api<Look>('POST', '/api/looks', { capsuleId: capsule.id, name: `Образ ${looks.length + 1}`, slots: {} }), 'Образ додано');
    if (look) go(`/studio?look=${look.id}`);
  };

  return (
    <div className="page">
      <div className="crumb"><a href={isSelection ? '#/capsules?tab=selections' : '#/capsules'}>{isSelection ? 'Підбірки' : 'Капсули'}</a></div>
      <div className="page-head">
        <div>
          <h1>{capsule.name}</h1>
          <div className="row wrap" style={{ marginTop: 12 }}>
            <Badge>{SEASON_LABEL[capsule.season]}</Badge>
            {isSelection && <Badge tone="ok">лише мої речі</Badge>}
            {capsule.situations.filter((s) => s.length <= 24).slice(0, 3).map((s) => <Badge key={s}>{s}</Badge>)}
          </div>
        </div>
        <div className="actions">
          {needs.length > 0 && <button className="btn" onClick={() => go('/shopping')}><ShoppingBag size={15} /> Докупити {needs.length}</button>}
          <button className={`icon-btn${capsule.favorite ? ' on' : ''}`} aria-label="Обране" onClick={() => void act(() => api('PATCH', `/api/capsules/${capsule.id}`, { favorite: !capsule.favorite }))}>
            <Heart size={15} fill={capsule.favorite ? 'currentColor' : 'none'} />
          </button>
          <button className="icon-btn" aria-label="Редагувати" onClick={() => setEditing(true)}><Pencil size={14} /></button>
          <ConfirmButton
            className="icon-btn"
            title={isSelection ? 'Видалити підбірку' : 'Видалити капсулу'}
            message={<>Видалити «{capsule.name}» і {looks.length} її образів? Речі в гардеробі залишаться.</>}
            onConfirm={async () => {
              const ok = await act(() => api('DELETE', `/api/capsules/${capsule.id}`), 'Видалено');
              if (ok !== undefined) go(isSelection ? '/capsules?tab=selections' : '/capsules');
            }}
          >
            <Trash2 size={14} />
          </ConfirmButton>
          <button className="btn primary" onClick={() => void addLook()}><Plus size={16} /> Образ</button>
        </div>
      </div>
      <div className="look-grid">{looks.map((l) => <LookCard key={l.id} look={l} />)}</div>

      <div className="section-head"><h2 className="h2">Речі капсули <span className="count">{pieces.size}</span></h2></div>
      <div className="ward-grid">
        {[...pieces.values()].map((r) => (
          <a key={`${r.ref.kind}-${r.ref.id}`} className="wtile" href={r.ref.kind === 'item' ? `#/wardrobe/${r.ref.id}` : `#/shopping?need=${r.ref.id}`}>
            <div className="img">
              {r.art ? <img src={thumb(r.art, 480)} alt={r.title} loading="lazy" /> : <span className="render-ph"><CategoryIcon category={r.category} size={22} /></span>}
              {r.kind !== 'owned' && r.kind !== 'candidate' && <span className="tl"><Badge tone="warn glass">{REF_KIND_LABEL[r.kind] === 'Бажаний тип' ? 'докупити' : REF_KIND_LABEL[r.kind]}</Badge></span>}
            </div>
            <span className="nm">{r.title}</span>
          </a>
        ))}
      </div>
      {editing && <EditCapsule capsule={capsule} onClose={() => setEditing(false)} />}
    </div>
  );
}
