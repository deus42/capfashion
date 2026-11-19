import { useMemo, useState } from 'react';
import { EyeOff, ImageOff, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { Capsule, Look, Season } from '../api.ts';
import { api } from '../api.ts';
import { go, useApp, useDb, useRoute } from '../store.tsx';
import { Badge, ConfirmButton, Empty, LookArt, Missing, Modal, PieceBlocks, RateButtons } from '../components/ui.tsx';
import { SEASON_LABEL, periodLine, autoCapsules, bestCapsule, capsuleLooks, capsuleRating, distinctLooks, isBestLook, lookRating, scoreLabel, isComplete, piecesOf, rankCapsules, rankLooks, readyLine, wardrobeCapsule, BEST_CAPSULE_ID, WARDROBE_CAPSULE_ID, WARDROBE_CAPSULE_NAME } from '../lib.ts';
import { hiddenLookIds, isCapsuleArchived, isCapsuleHidden } from '../rating.ts';
import { CapsuleTile, tileCovers } from './Home.tsx';


export function CapsulesPage() {
  const db = useDb();
  const { query } = useRoute();
  // The tab lives in the address, so links and Back switch it even while this page is open.
  const tab = (['selections', 'looks', 'hidden'] as const).find((t) => t === query.get('tab')) ?? 'capsules';
  const setTab = (t: typeof tab) => go(t === 'capsules' ? '/capsules' : `/capsules?tab=${t}`);
  const shown = db.capsules.filter((c) => !isCapsuleHidden(db, c));
  const ready = wardrobeCapsule(db);
  const capsules = [...autoCapsules(db), ...rankCapsules(db, shown.filter((c) => c.kind !== 'selection'))];
  const selections = rankCapsules(db, shown.filter((c) => c.kind === 'selection').reverse());
  const list = tab === 'capsules' ? capsules : selections;
  const covers = tileCovers(db, list);
  // Each capsule's lead look first, then the rest of the catalogue.
  const orderedLooks = capsuleLooks(db, [...new Set([...db.capsules.flatMap((c) => c.lookIds.slice(0, 1)), ...db.looks.map((l) => l.id)])]);
  const allLooks = distinctLooks(db, orderedLooks);
  const readyOnly = tab === 'looks' && query.get('owned') === '1';
  const filteredLooks = readyOnly ? capsuleLooks(db, ready.lookIds) : allLooks;
  const hiddenCaps = db.capsules.filter((c) => !isCapsuleArchived(c) && isCapsuleHidden(db, c));
  const hiddenLooks = capsuleLooks(db, [...hiddenLookIds(db)]).filter((l) => !hiddenCaps.some((c) => c.lookIds.includes(l.id)));
  const hiddenCount = hiddenCaps.length + hiddenLooks.length;
  const title = { capsules: 'Капсули', selections: 'Підбірки', looks: readyOnly ? WARDROBE_CAPSULE_NAME : 'Усі образи', hidden: 'Приховані' }[tab];

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{title}</h1></div>
        <div className="actions">
          <div className="seg" style={{ flexWrap: 'wrap', maxWidth: '100%' }}>
            <button className={tab === 'capsules' ? 'on' : ''} onClick={() => setTab('capsules')}>Капсули <span className="faint">{capsules.length}</span></button>
            {(selections.length > 0 || tab === 'selections') && <button className={tab === 'selections' ? 'on' : ''} onClick={() => setTab('selections')}>Підбірки <span className="faint">{selections.length}</span></button>}
            <button className={tab === 'looks' ? 'on' : ''} onClick={() => setTab('looks')}>Усі образи <span className="faint">{allLooks.length}</span></button>
            {hiddenCount > 0 && <button className={tab === 'hidden' ? 'on' : ''} onClick={() => setTab('hidden')}><EyeOff size={13} /> Приховані <span className="faint">{hiddenCount}</span></button>}
          </div>
        </div>
      </div>
      {/* Below the tabs, not beside them: a button appearing next to the tabs made them jump when switching. */}
      {tab === 'looks' && <div className="toolbar"><span className="grow" /><ReadyFilter active={readyOnly} href={readyOnly ? '/capsules?tab=looks' : '/capsules?tab=looks&owned=1'} /></div>}
      {tab === 'hidden' ? (
        hiddenCount === 0 ? <Empty icon={<EyeOff />} title="Нічого не приховано" /> : <>
          {hiddenCaps.length > 0 && <div className="capsule-grid" style={{ marginBottom: 30 }}>{hiddenCaps.map((c) => <CapsuleTile key={c.id} c={c} />)}</div>}
          {hiddenLooks.length > 0 && <div className="look-grid">{hiddenLooks.map((l) => <LookCard key={l.id} look={l} />)}</div>}
        </>
      ) : tab === 'looks' ? <LookGrid looks={filteredLooks} heading={false} /> : list.length === 0 ? (
        tab === 'selections' ? <Empty icon={<Sparkles />} title="Підбірок ще немає" /> : <Empty icon={<Sparkles />} title="Капсул ще немає" />
      ) : (
        <div className="capsule-grid">{list.map((c) => <CapsuleTile key={c.id} c={c} cover={covers.get(c.id)} />)}</div>
      )}
    </div>
  );
}

function ReadyFilter({ active, href }: { active: boolean; href: string }) {
  return <button type="button" className={`btn sm${active ? ' primary' : ''}`} aria-pressed={active} onClick={() => go(href)}>{WARDROBE_CAPSULE_NAME}</button>;
}

/** Looks already reduced to one card per look (see distinctLooks). */
function LookGrid({ looks, heading = true, filter, mark = true }: { looks: Look[]; heading?: boolean; filter?: React.ReactNode; mark?: boolean }) {
  const db = useDb();
  // «Найкращий» only where it tells something; when some cards carry it, the others keep its line so names line up.
  const marked = mark && looks.some((l) => isBestLook(db, l.id));
  return <>
    {heading && <div className="section-head"><h2 className="h2">Образи <span className="count">{looks.length}</span></h2>{filter}</div>}
    {looks.length ? <div className="look-grid">{looks.map((l) => <LookCard key={l.id} look={l} mark={marked} />)}</div> : <Empty icon={<ImageOff />} title="Образів ще немає" />}
  </>;
}

export function EditLook({ look, onClose }: { look: Look; onClose: () => void }) {
  const db = useDb();
  const { act } = useApp();
  const [name, setName] = useState(look.name);
  const [note, setNote] = useState(look.note ?? '');
  const [capsuleId, setCapsuleId] = useState(look.capsuleId ?? '');
  const capsules = db.capsules.filter((c) => !isCapsuleArchived(c) && (!c.disliked || c.id === look.capsuleId));
  const renders = db.results.filter((r) => r.lookId === look.id).length;
  return (
    <Modal
      title="Образ"
      onClose={onClose}
      footer={
        <>
          <ConfirmButton
            className="btn ghost danger"
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
            <Trash2 size={15} />
          </ConfirmButton>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Скасувати</button>
          <button
            className="btn primary"
            disabled={!capsuleId}
            onClick={async () => {
              const ok = await act(() => api('PATCH', `/api/looks/${look.id}`, { rev: look.rev, name, note, capsuleId }), 'Збережено');
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
        <label className="field full"><span>Капсула</span><select className="select" value={capsuleId} onChange={(e) => setCapsuleId(e.target.value)}>
          {!capsuleId && <option value="" disabled>Вибери капсулу</option>}
          {capsules.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>
        <label className="field full"><span>Нотатка</span><textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
    </Modal>
  );
}

function LookCard({ look, mark = false }: { look: Look; mark?: boolean }) {
  const db = useDb();
  const best = mark && isBestLook(db, look.id);
  return (
    <div className="look-card">
      <a className="cover" style={{ aspectRatio: '2 / 3' }} href={`/looks/${look.id}`}>
        <LookArt look={look} />
      </a>
      {/* Above the name, not on the picture: on a phone a corner label covered the face. */}
      <a href={`/looks/${look.id}`}>{mark && <span className={`eyebrow-sm best-mark${best ? '' : ' ghost'}`} aria-hidden={!best}>Найкращий</span>}<h4 title={look.note}>{look.name}</h4><Missing look={look} /></a>
      <div className="card-foot">
        <RateButtons kind="look" target={look} size="sm" />
        {lookRating(look) !== null && <span className="score">{scoreLabel(lookRating(look)!)}</span>}
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
              if (ok !== undefined) go(capsule.kind === 'selection' ? '/capsules?tab=selections' : '/capsules', true);
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
  const { query } = useRoute();
  const [editing, setEditing] = useState(false);
  const capsule = db.capsules.find((c) => c.id === id);
  const allLooks = useMemo(() => capsuleLooks(db, capsule?.lookIds ?? []), [capsule, db]);
  if (id === WARDROBE_CAPSULE_ID || id === BEST_CAPSULE_ID) {
    const ready = id === BEST_CAPSULE_ID ? bestCapsule(db) : wardrobeCapsule(db);
    const looks = capsuleLooks(db, ready.lookIds);
    return <div className="page">
      <div className="crumb"><a href="/capsules">Капсули</a></div>
      <div className="page-head"><div><h1>{ready.name}</h1>{capsuleRating(db, ready) !== null && <p className="miss" style={{ marginTop: 6 }}>{scoreLabel(capsuleRating(db, ready)!)}</p>}</div></div>
      <LookGrid looks={looks} mark={id !== BEST_CAPSULE_ID} />
    </div>;
  }
  if (!capsule) return <div className="page"><Empty icon={<ImageOff />} title="Не знайдено" /></div>;
  if (capsule.redirectCapsuleIds) {
    const targets = db.capsules.filter((c) => capsule.redirectCapsuleIds!.includes(c.id));
    return <div className="page">
      <div className="crumb"><a href="/capsules">Капсули</a></div>
      <div className="page-head"><h1>{capsule.name}</h1></div>
      {targets.length ? <div className="capsule-grid">{targets.map((c) => <CapsuleTile key={c.id} c={c} />)}</div> : <Empty icon={<ImageOff />} title="Капсулу перенесено" />}
    </div>;
  }
  const hidden = isCapsuleHidden(db, capsule);
  // A hidden capsule opened from «Приховані» shows its looks so it can be judged again.
  const readyOnly = !hidden && query.get('owned') === '1';
  const looks = hidden ? rankLooks(db, allLooks) : distinctLooks(db, readyOnly ? allLooks.filter((l) => isComplete(db, l)) : allLooks);
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
          {capsule.periods?.length ? <span className="eyebrow-sm">{periodLine(capsule, true)}</span> : null}
          <h1>{capsule.name}</h1>
          {(readyLine(db, capsule) || capsuleRating(db, capsule) !== null) && <p className="miss" style={{ marginTop: 6 }}>{[readyLine(db, capsule), capsuleRating(db, capsule) !== null ? scoreLabel(capsuleRating(db, capsule)!) : ''].filter(Boolean).join(' · ')}</p>}
          <div className="row wrap" style={{ marginTop: 12 }}>
            {capsule.season !== 'all' && !capsule.periods?.length && <Badge>{SEASON_LABEL[capsule.season]}</Badge>}
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
      <LookGrid looks={looks} filter={!hidden && <ReadyFilter active={readyOnly} href={`/capsules/${capsule.id}${readyOnly ? '' : '?owned=1'}`} />} />
      <PieceBlocks pieces={pieces} ownTitle="Речі капсули" />
      {editing && <EditCapsule capsule={capsule} onClose={() => setEditing(false)} />}
    </div>
  );
}
