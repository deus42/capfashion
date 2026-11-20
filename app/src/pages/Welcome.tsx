import { useState } from 'react';
import type { WardrobeFocus } from '../api.ts';
import { api } from '../api.ts';
import { useApp, useDb } from '../store.tsx';
import { currentLanguage, t } from '../i18n.ts';

const FOCUS: [WardrobeFocus, string][] = [['men', 'Чоловічий'], ['women', 'Жіночий'], ['any', 'Будь-який']];

/**
 * First sign-in (production spec §3), one short step per screen: what clothes to dress the person in, then the
 * consent. The language comes from the browser and is saved with them; it changes in «Профіль → Побажання».
 */
export function Welcome() {
  const db = useDb();
  const { act } = useApp();
  const [focus, setFocus] = useState<WardrobeFocus | null>(db.profile.wardrobeFocus ?? null);
  const [step, setStep] = useState<'focus' | 'consent'>(db.profile.wardrobeFocus ? 'consent' : 'focus');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    await act(() => api('PATCH', '/api/profile', { rev: db.profile.rev, wardrobeFocus: focus, language: currentLanguage(), consent: true }));
    setBusy(false);
  };

  return (
    <main className="landing">
      <div className="landing-inner welcome">
        <p className="landing-mark small-mark">Capsula</p>
        {step === 'focus' ? (
          <>
            <h1 className="welcome-q">{t('Який одяг підбирати?')}</h1>
            <div className="welcome-choices">
              {FOCUS.map(([k, label]) => (
                <button key={k} className={`landing-google${focus === k ? ' on' : ''}`} onClick={() => { setFocus(k); setStep('consent'); }}>{t(label)}</button>
              ))}
            </div>
          </>
        ) : (
          <>
            <label className="welcome-consent">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>{t('На фото я або людина, яка дала згоду. Мені 18+.')}</span>
            </label>
            <p className="landing-note">
              <a href="/terms" target="_blank" rel="noreferrer">{t('Умови')}</a> · <a href="/privacy" target="_blank" rel="noreferrer">{t('Приватність')}</a>
            </p>
            <div className="welcome-choices">
              <button className="quiet-toggle" onClick={() => setStep('focus')}>{t('Назад')}</button>
              <button className="landing-google" disabled={!agreed || !focus || busy} onClick={() => void start()}>{t('Почати')}</button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
