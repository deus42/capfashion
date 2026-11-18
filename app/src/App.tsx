import { useEffect } from 'react';
import type { ReactNode } from 'react';
import {
  Camera, House, Images, LayoutGrid, Loader2, Shirt, ShoppingBag, TriangleAlert, User,
} from 'lucide-react';
import { useApp, useRoute, go } from './store.tsx';
import { Img, JobBar } from './components/ui.tsx';
import { expectedSeconds } from './lib.ts';
import { HomePage, useIntake } from './pages/Home.tsx';
import { CapsuleDetail, CapsulesPage } from './pages/Capsules.tsx';
import { LookPage } from './pages/Look.tsx';
import { WardrobePage } from './pages/Wardrobe.tsx';
import { GalleryPage } from './pages/Gallery.tsx';
import { ShoppingPage } from './pages/Shopping.tsx';
import { ProfilePage } from './pages/Profile.tsx';

function RailItem({ to, icon, label, active, dot, desk }: { to: string; icon: ReactNode; label: string; active: boolean; dot?: number; desk?: boolean }) {
  return (
    <a href={`/${to}`} className={`rail-item${active ? ' active' : ''}${desk ? ' desk' : ''}`} aria-current={active ? 'page' : undefined}>
      {icon}
      <span>{label}</span>
      {dot ? <span className="dot">{dot > 9 ? '9+' : dot}</span> : null}
    </a>
  );
}

/** Old addresses (the retired studio) land on their new page. */
function Redirect({ to }: { to: string }) {
  useEffect(() => go(to, true), [to]);
  return null;
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

  const { db } = state;
  // The thin bar means work is happening now; queued work waiting for its turn shows nothing.
  // The top bar follows the running work that will finish last, so it fills once from start to end.
  const lastToFinish = db.jobs
    .filter((j) => j.state === 'running' && j.startedAt)
    .sort((a, b) => new Date(b.startedAt!).getTime() + expectedSeconds(db, b.kind) * 1000 - (new Date(a.startedAt!).getTime() + expectedSeconds(db, a.kind) * 1000))[0];
  const avatar = db.profile.identity?.approvedPortrait ? db.profile.identity.face : db.profile.basePhotoIds.map((id) => db.photos.find((p) => p.id === id)).find(Boolean);
  const ic = 20;

  let page: ReactNode;
  if (section === 'capsules' && parts[1]) page = <CapsuleDetail id={parts[1]} />;
  else if (section === 'capsules') page = <CapsulesPage />;
  else if (section === 'looks' && parts[1]) page = <LookPage id={parts[1]} />;
  else if (section === 'wardrobe') page = <WardrobePage openId={parts[1]} />;
  else if (section === 'studio') page = <Redirect to={query.get('look') ? `/looks/${query.get('look')}` : '/capsules'} />;
  else if (section === 'gallery') page = <GalleryPage />;
  else if (section === 'queue') page = <Redirect to="/home" />;
  else if (section === 'shopping') page = <ShoppingPage focus={query.get('need') ?? undefined} />;
  else if (section === 'profile') page = <ProfilePage tab={parts[1]} />;
  else if (section === 'glossary') page = <Redirect to="/home" />;
  else page = <HomePage />;

  return (
    <div className="shell">
      <nav className="rail" aria-label="Розділи">
        <a href="/home" className="rail-logo" aria-label="Cap Fashion">
          <Shirt size={18} />
        </a>
        <RailItem to="home" icon={<House size={ic} />} label="Головна" active={section === 'home'} />
        <RailItem to="capsules" icon={<LayoutGrid size={ic} />} label="Капсули" active={section === 'capsules' || section === 'looks'} />
        <RailItem to="gallery" icon={<Images size={ic} />} label="Галерея" active={section === 'gallery'} />
        <RailItem to="wardrobe" icon={<Shirt size={ic} />} label="Гардероб" active={section === 'wardrobe'} />
        <RailItem to="shopping" icon={<ShoppingBag size={ic} />} label="Покупки" active={section === 'shopping'} />
        <div className="rail-spacer" />
        <a href="/profile" className={`rail-avatar${section === 'profile' ? ' active' : ''}`} aria-label="Мій профіль" title="Мій профіль">
          {avatar ? <Img path={avatar.path} w={120} /> : <User size={18} />}
        </a>
      </nav>
      <div className="frame">
        {lastToFinish && <JobBar job={lastToFinish} className="app-progress" />}
        <header className="topbar">
          <a href="/home" className="wordmark m-only">Cap Fashion</a>
          <div className="grow" />
          <button className="btn primary sm" onClick={intake.pick} disabled={intake.busy}>
            {intake.busy ? <Loader2 size={14} className="spin" /> : <Camera size={14} />} Додати фото
          </button>
          {intake.field}
          <a href="/profile" className="top-avatar m-only" aria-label="Мій профіль">
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

