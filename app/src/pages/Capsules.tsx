import { useMemo, useState } from 'react';
import { EyeOff, ImageOff, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { Capsule, Look, Season } from '../api.ts';
import { api } from '../api.ts';
import { go, useApp, useDb, useRoute } from '../store.tsx';
import { Badge, ConfirmButton, Empty, LookArt, Modal, PieceBlocks, RateButtons } from '../components/ui.tsx';
import { SEASON_LABEL, capsuleLooks, distinctLooks, missingLine, piecesOf, rankCapsules, rankLooks, readyLine } from '../lib.ts';
import { hiddenLookIds, isCapsuleHidden } from '../rating.ts';
import { CapsuleTile } from './Home.tsx';


export function CapsulesPage() {
  const db = useDb();
  const { query } = useRoute();
  // The tab lives in the address, so links and Back switch it even while this page is open.
  const tab = (['selections', 'looks', 'hidden'] as const).find((t) => t === query.get('tab')) ?? 'capsules';
  const setTab = (t: typeof tab) => go(t === 'capsules' ? '/capsules' : `/capsules?tab=${t}`);
  const shown = db.capsules.filter((c) => !isCapsuleHidden(db, c));
  const capsules = rankCapsules(db, shown.filter((c) => c.kind !== 'selection'));
  const selections = rankCapsules(db, shown.filter((c) => c.kind === 'selection').reverse());
  const list = tab === 'capsules' ? capsules : selections;
  // Each capsule's lead look first, then the rest of the catalogue.
  const orderedLooks = capsuleLooks(db, [...new Set([...db.capsules.flatMap((c) => c.lookIds.slice(0, 1)), ...db.looks.map((l) => l.id)])]);
  const allLooks = distinctLooks(db, orderedLooks);
  const hiddenCaps = db.capsules.filter((c) => isCapsuleHidden(db, c));
  const hiddenLooks = capsuleLooks(db, [...hiddenLookIds(db)]).filter((l) => !hiddenCaps.some((c) => c.lookIds.includes(l.id)));
  const hiddenCount = hiddenCaps.length + hiddenLooks.length;
  const title = { capsules: 'Капсули', selections: 'Підбірки', looks: 'Усі образи', hidden: 'Приховані' }[tab];

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{title}</h1></div>
        <div className="actions">
          <div className="seg" style={{ flexWrap: 'wrap', maxWidth: '100%' }}>
            <button className={tab === 'capsules' ? 'on' : ''} onClick={() => setTab('capsules')}>Капсули <span className="faint">{capsules.length}</span></button>
            <button className={tab === 'selections' ? 'on' : ''} onClick={() => setTab('selections')}>З моїх речей <span className="faint">{selections.length}</span></button>
            <button className={tab === 'looks' ? 'on' : ''} onClick={() => setTab('looks')}>Усі образи <span className="faint">{allLooks.length}</span></button>
            {hiddenCount > 0 && <button className={tab === 'hidden' ? 'on' : ''} onClick={() => setTab('hidden')}><EyeOff size={13} /> Приховані <span className="faint">{hiddenCount}</span></button>}
          </div>
        </div>
      </div>
      {tab === 'hidden' ? (
        hiddenCount === 0 ? <Empty icon={<EyeOff />} title="Нічого не приховано" /> : <>
          {hiddenCaps.length > 0 && <div className="capsule-grid" style={{ marginBottom: 30 }}>{hiddenCaps.map((c) => <CapsuleTile key={c.id} c={c} />)}</div>}
          {hiddenLooks.length > 0 && <div className="look-grid">{hiddenLooks.map((l) => <LookCard key={l.id} look={l} />)}</div>}
        </>
      ) : tab === 'looks' ? <LookGrid looks={allLooks} heading={false} /> : list.length === 0 ? (
        tab === 'selections' ? <Empty icon={<Sparkles />} title="Підбірок ще немає" /> : <Empty icon={<Sparkles />} title="Капсул ще немає" />
      ) : (
        <div className="capsule-grid">{list.map((c) => <CapsuleTile key={c.id} c={c} />)}</div>
      )}
    </div>
  );
}

/** Looks already reduced to one card per look (see distinctLooks). */
function LookGrid({ looks, heading = true }: { looks: Look[]; heading?: boolean }) {
  return <>
    {heading && <div className="section-head"><h2 className="h2">Образи <span className="count">{looks.length}</span></h2></div>}
    <div className="look-grid">{looks.map((l) => <LookCard key={l.id} look={l} />)}</div>
  </>;
}

export function EditLook({ look, onClose }: { look: Look; onClose: () => void }) {
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
              if (ok === undefined) return;
              onClose();
              // Leaving the deleted look's own page: back to its capsule.
              if (location.pathname === `/looks/${look.id}`) go(look.capsuleId ? `/capsules/${look.capsuleId}` : '/capsules?tab=looks', true);
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
    </Modal>
  );
}

function LookCard({ look }: { look: Look }) {
  const db = useDb();
  const miss = missingLine(db, look);
  return (
    <div className="look-card">
      <a className="cover" style={{ aspectRatio: '2 / 3' }} href={`/looks/${look.id}`}>
        <LookArt look={look} />
      </a>
      <a href={`/looks/${look.id}`}><h4 title={look.note}>{look.name}</h4>{miss && <span className="miss">{miss}</span>}</a>
      <div className="card-foot">
        <RateButtons kind="look" target={look} size="sm" />
      </div>
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
    <Modal
      title="Редагувати"
      onClose={onClose}
      footer={
        <>
          <ConfirmButton
            className="btn ghost danger"
            title={capsule.kind === 'selection' ? 'Видалити підбірку' : 'Видалити капсулу'}
            message={<>Видалити «{capsule.name}» і її образи назавжди? Щоб просто прибрати з очей — постав 👎. Речі в гардеробі залишаться.</>}
            onConfirm={async () => {
              const ok = await act(() => api('DELETE', `/api/capsules/${capsule.id}`), 'Видалено');
              if (ok !== undefined) go(capsule.kind === 'selection' ? '/capsules?tab=selections' : '/capsules');
            }}
          >
            <Trash2 size={14} />
          </ConfirmButton>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Скасувати</button>
          <button className="btn primary" onClick={() => void save()}>Зберегти</button>
        </>
      }
    >
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
  const allLooks = useMemo(() => capsuleLooks(db, capsule?.lookIds ?? []), [capsule, db]);
  if (!capsule) return <div className="page"><Empty icon={<ImageOff />} title="Не знайдено" /></div>;
  const hidden = isCapsuleHidden(db, capsule);
  // A hidden capsule opened from «Приховані» shows its looks so it can be judged again.
  const looks = hidden ? rankLooks(db, allLooks) : distinctLooks(db, allLooks);
  const pieces = looks.flatMap((l) => piecesOf(db, l.slots));
  const isSelection = capsule.kind === 'selection';

  const addLook = async () => {
    const look = await act(() => api<Look>('POST', '/api/looks', { capsuleId: capsule.id, name: `Образ ${allLooks.length + 1}`, slots: {} }), 'Образ додано');
    if (look) go(`/looks/${look.id}`);
  };

  return (
    <div className="page">
      <div className="crumb"><a href={isSelection ? '/capsules?tab=selections' : '/capsules'}>{isSelection ? 'Підбірки' : 'Капсули'}</a></div>
      <div className="page-head">
        <div>
          <h1>{capsule.name}</h1>
          {readyLine(db, capsule) && <p className="miss" style={{ marginTop: 6 }}>{readyLine(db, capsule)}</p>}
          <div className="row wrap" style={{ marginTop: 12 }}>
            <Badge>{SEASON_LABEL[capsule.season]}</Badge>
            {isSelection && <Badge tone="ok">лише мої речі</Badge>}
            {hidden && <Badge>приховано</Badge>}
            {capsule.situations.filter((s) => s.length <= 24).slice(0, 3).map((s) => <Badge key={s}>{s}</Badge>)}
          </div>
        </div>
        <div className="actions">
          <RateButtons kind="capsule" target={capsule} />
          <button className="icon-btn" aria-label="Редагувати" onClick={() => setEditing(true)}><Pencil size={14} /></button>
          <button className="btn primary" onClick={() => void addLook()}><Plus size={16} /> Образ</button>
        </div>
      </div>
      <LookGrid looks={looks} />
      <PieceBlocks pieces={pieces} ownTitle="Речі капсули" />
      {editing && <EditCapsule capsule={capsule} onClose={() => setEditing(false)} />}
    </div>
  );
}
