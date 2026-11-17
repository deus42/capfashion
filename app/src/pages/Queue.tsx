import { useEffect, useState } from 'react';
import { FileText, Inbox, Loader2, Play, RotateCcw, Sparkles } from 'lucide-react';
import type { Job } from '../api.ts';
import { api, getLog, thumb } from '../api.ts';
import { useApp, useDb } from '../store.tsx';
import { Badge, Empty, Modal } from '../components/ui.tsx';
import { JOB_LABEL, JOB_TONE, REVIEW_LABEL, REVIEW_TONE, SLOT_LABEL, fmtDate } from '../lib.ts';

function LogModal({ job, onClose }: { job: Job; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    void getLog(job.id).then((r) => setText(r.log || '(порожньо)'), (e: Error) => setText(e.message));
  }, [job.id]);
  return (
    <Modal title={`Журнал ${job.id}`} onClose={onClose} wide>
      <pre className="log">{text ?? 'Завантаження…'}</pre>
    </Modal>
  );
}

export function QueuePage() {
  const db = useDb();
  const { act, state } = useApp();
  const [log, setLog] = useState<Job | null>(null);
  const jobs = db.jobs.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const queued = jobs.filter((j) => j.state === 'queued').length;
  const runner = state!.runner;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Черга примірок</h1>
          <p>
            Кожне завдання — знімок вибраних речей і фото на момент додавання. Обробляє локальний Codex ({db.settings.codexModel}, {db.settings.reasoningEffort}) по одному, без чату.
          </p>
        </div>
        <div className="actions">
          <button className="btn primary" disabled={runner.running || queued === 0} onClick={() => void act(() => api('POST', '/api/runner/run'), 'Обробку запущено')}>
            {runner.running ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
            {runner.running ? 'Обробляється…' : `Запустити чергу${queued ? ` (${queued})` : ''}`}
          </button>
        </div>
      </div>
      {runner.lastError && <div className="note warn" style={{ marginBottom: 14 }}>Остання помилка обробника: {runner.lastError}</div>}

      {jobs.length === 0 ? (
        <Empty icon={<Inbox />} title="Черга порожня">Додай примірку з розділу «Примірка».</Empty>
      ) : (
        <div className="list">
          {jobs.map((j) => {
            const result = j.resultId ? db.results.find((r) => r.id === j.resultId) : undefined;
            const look = db.looks.find((l) => l.id === j.lookId);
            const prev = j.retryOf ? db.jobs.find((x) => x.id === j.retryOf) : undefined;
            return (
              <div key={j.id} className="card list-row">
                <a className="thumb" href={`#/studio?look=${j.lookId}${result ? `&result=${result.id}` : ''}`}>
                  {result ? <img src={thumb(result.imagePath, 200)} alt="" /> : j.state === 'running' ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
                </a>
                <div className="grow stack" style={{ gap: 4 }}>
                  <div className="row wrap">
                    <span className="title">{j.snapshot.lookName || look?.name}</span>
                    <Badge tone={JOB_TONE[j.state]}>{JOB_LABEL[j.state]}</Badge>
                    {result && <Badge tone={REVIEW_TONE[result.review]}>{REVIEW_LABEL[result.review]}</Badge>}
                    <span className="small faint">v{j.lookVersion}</span>
                    {j.origin === 'import' && <Badge>імпорт</Badge>}
                  </div>
                  {j.stateNote && <span className="small muted">{j.stateNote}</span>}
                  <span className="small faint">
                    {fmtDate(j.createdAt)}
                    {prev && ` · повтор спроби від ${fmtDate(prev.createdAt)}`}
                    {j.snapshot.slots.length > 0 && ` · ${j.snapshot.slots.map((s) => `${SLOT_LABEL[s.slot]}: ${s.title}`).join(' · ')}`}
                  </span>
                  {j.instructions && <span className="small">«{j.instructions}»</span>}
                </div>
                <div className="row">
                  {j.logPath && (
                    <button className="btn sm ghost" onClick={() => setLog(j)}>
                      <FileText size={13} /> Журнал
                    </button>
                  )}
                  {(j.state === 'error' || j.state === 'needs_data' || j.state === 'done') && (
                    <button className="btn sm" onClick={() => void act(() => api('POST', `/api/jobs/${j.id}/retry`, { run: true }), 'Повторна спроба запущена')}>
                      <RotateCcw size={13} /> Повторити
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {log && <LogModal job={log} onClose={() => setLog(null)} />}
    </div>
  );
}
