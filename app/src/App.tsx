import type { ReactNode } from 'react';
import {
  BookOpen, Camera, ChevronsUpDown, House, Images, Inbox, LayoutGrid, Loader2, Shirt, ShoppingBag, Sparkles, TriangleAlert, User,
} from 'lucide-react';
import { useApp, useRoute, go } from './store.tsx';
import { Img } from './components/ui.tsx';
import { HomePage, useIntake } from './pages/Home.tsx';
import { CapsuleDetail, CapsulesPage } from './pages/Capsules.tsx';
import { LookPage } from './pages/Look.tsx';
import { WardrobePage } from './pages/Wardrobe.tsx';
import { StudioPage } from './pages/Studio.tsx';
import { GalleryPage } from './pages/Gallery.tsx';
import { QueuePage } from './pages/Queue.tsx';
import { ShoppingPage } from './pages/Shopping.tsx';
import { ProfilePage } from './pages/Profile.tsx';
import { GlossaryPage } from './pages/Glossary.tsx';

function RailItem({ to, icon, label, active, dot, desk }: { to: string; icon: ReactNode; label: string; active: boolean; dot?: number; desk?: boolean }) {
  return (
    <a href={`#/${to}`} className={`rail-item${active ? ' active' : ''}${desk ? ' desk' : ''}`} aria-current={active ? 'page' : undefined}>
      {icon}
      <span>{label}</span>
      {dot ? <span className="dot">{dot > 9 ? '9+' : dot}</span> : null}
    </a>
  );
}

export default function App() {
  const { state, error } = useApp();
  const { parts, query } = useRoute();
  const intake = useIntake();
  const section = parts[0] ?? 'home';

  if (!state) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--muted)' }}>
        {error ? (
          <div className="stack" style={{ alignItems: 'center' }}>
            <TriangleAlert />
            <b>Сервер недоступний</b>
            <span className="small">{error}</span>
          </div>
        ) : (
          <Loader2 className="spin" />
        )}
      </div>
    );
  }

  const { db, runner } = state;
  const pendingReview = db.results.filter((r) => r.review === 'pending').length;
  const activeJobs = db.jobs.filter((j) => j.state === 'queued' || j.state === 'running').length;
  const avatar = db.profile.basePhotoIds.map((id) => db.photos.find((p) => p.id === id)).find(Boolean);
  const ic = 20;

  let page: ReactNode;
  if (section === 'capsules' && parts[1]) page = <CapsuleDetail id={parts[1]} />;
  else if (section === 'capsules') page = <CapsulesPage />;
  else if (section === 'looks' && parts[1]) page = <LookPage id={parts[1]} />;
  else if (section === 'wardrobe') page = <WardrobePage openId={parts[1]} />;
  else if (section === 'studio') page = <StudioPage lookId={query.get('look') ?? undefined} resultId={query.get('result') ?? undefined} />;
  else if (section === 'gallery') page = <GalleryPage />;
  else if (section === 'queue') page = <QueuePage />;
  else if (section === 'shopping') page = <ShoppingPage focus={query.get('need') ?? undefined} />;
  else if (section === 'profile') page = <ProfilePage tab={parts[1]} />;
  else if (section === 'glossary') page = <GlossaryPage focus={query.get('term') ?? undefined} />;
  else page = <HomePage />;

  return (
    <div className="shell">
      <nav className="rail" aria-label="Розділи">
        <a href="#/home" className="rail-logo" aria-label="Cap Fashion">
          <Shirt size={18} />
        </a>
        <RailItem to="home" icon={<House size={ic} />} label="Головна" active={section === 'home'} />
        <RailItem to="capsules" icon={<LayoutGrid size={ic} />} label="Капсули" active={section === 'capsules' || section === 'looks'} />
        <RailItem to="studio" icon={<Sparkles size={ic} />} label="Примірка" active={section === 'studio'} dot={pendingReview} />
        <RailItem to="gallery" icon={<Images size={ic} />} label="Галерея" active={section === 'gallery'} />
        <RailItem to="wardrobe" icon={<Shirt size={ic} />} label="Гардероб" active={section === 'wardrobe'} />
        <RailItem to="shopping" icon={<ShoppingBag size={ic} />} label="Покупки" active={section === 'shopping'} desk />
        <div className="rail-spacer" />
        <RailItem to="queue" icon={<Inbox size={ic} />} label="Черга" active={section === 'queue'} dot={activeJobs} desk />
        <RailItem to="glossary" icon={<BookOpen size={ic} />} label="Довідка" active={section === 'glossary'} desk />
        <a href="#/profile" className={`rail-avatar${section === 'profile' ? ' active' : ''}`} aria-label="Мій профіль" title="Мій профіль">
          {avatar ? <Img path={avatar.path} w={120} /> : <User size={18} />}
        </a>
      </nav>
      <div className="frame">
        <header className="topbar">
          <a href="#/home" className="org-pill">
            <small>Гардероб</small>
            <b>Cap Fashion</b>
            <ChevronsUpDown size={14} className="faint" />
          </a>
          <div className="grow" />
          <span className="tag">Local</span>
          <button className="credits" onClick={() => go('/queue')} title="Черга примірок і packshot">
            {runner.running ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
            <span className="lbl">
              Codex · <b>{db.settings.codexModel.replace(/^gpt-/, '')}</b>
            </span>
            {activeJobs > 0 && <b>{activeJobs} в роботі</b>}
          </button>
          <button className="btn primary sm" onClick={intake.pick} disabled={intake.busy}>
            {intake.busy ? <Loader2 size={14} className="spin" /> : <Camera size={14} />} Додати фото
          </button>
          {intake.field}
          <a href="#/profile" className="top-avatar m-only" aria-label="Мій профіль">
            {avatar ? <Img path={avatar.path} w={120} /> : <User size={16} />}
          </a>
        </header>
        {state.recovered && (
          <div className="banner warn">
            <TriangleAlert size={16} /> Основний файл даних був пошкоджений — відкрито останню валідну копію. Наступне збереження відновить файл.
          </div>
        )}
        <main className="main">{page}</main>
      </div>
    </div>
  );
}

