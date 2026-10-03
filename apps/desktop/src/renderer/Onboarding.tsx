import { useEffect, useState } from 'react';
import { core } from './rpc';

type Plan = {
  entries: { key: string; title: string; status: string; bytes: number }[];
  total_bytes: number;
};
const gb = (b: number) => `${(b / 1e9).toFixed(1)} GB`;

/** UI-01 Onboarding: đăng nhập Claude → hồ sơ cài đặt (dung lượng) → tải → khóa API (tùy chọn). */
export function Onboarding({
  status,
  onDone,
}: {
  status: { auth: { ok: boolean; method: string; detail?: string } };
  onDone: () => void;
}) {
  const [profile, setProfile] = useState<'minimal' | 'standard' | 'full'>('standard');
  const [plan, setPlan] = useState<Plan>();
  const [jobs, setJobs] = useState<Record<string, { status: string; pct: number }>>({});

  useEffect(() => {
    void core.call('install.plan', { profile }).then((p) => setPlan(p as Plan));
  }, [profile]);
  useEffect(
    () =>
      core.on('job.updated', (j) => {
        if (j.kind !== 'download') return;
        setJobs((s) => ({
          ...s,
          [j.id]: {
            status: j.status,
            pct: j.progress.total ? Math.round((j.progress.done / j.progress.total) * 100) : 0,
          },
        }));
      }),
    [],
  );
  const start = async () => {
    // FN-014: hỏi trước khi tải gói > 1 GB
    if (plan && plan.total_bytes > 1e9 && !window.confirm(`Tải ${gb(plan.total_bytes)}?`)) return;
    await core.call('install.start', { profile });
  };

  return (
    <div className="modal" role="dialog" aria-label="Thiết lập ban đầu">
      <div className="card">
        <h2>Thiết lập StudioFlow</h2>
        <p>
          Đăng nhập Claude:{' '}
          {status.auth.ok ? (
            <b>đã sẵn sàng ({status.auth.method})</b>
          ) : (
            <b className="error">chưa — chạy `claude login` trong Claude Code</b>
          )}
        </p>
        <label>
          Hồ sơ cài đặt{' '}
          <select value={profile} onChange={(e) => setProfile(e.target.value as typeof profile)}>
            <option value="minimal">Tối thiểu</option>
            <option value="standard">Chuẩn</option>
            <option value="full">Đầy đủ</option>
          </select>
        </label>
        <ul className="list">
          {plan?.entries.map((e) => (
            <li key={e.key}>
              {e.title} —{' '}
              {e.status === 'installed' || e.status === 'system' ? 'đã có' : gb(e.bytes)}
            </li>
          ))}
        </ul>
        <p>Cần tải: {plan ? gb(plan.total_bytes) : '…'}</p>
        {Object.entries(jobs).map(([id, j]) => (
          <div key={id}>
            {id}: {j.status} {j.pct}%
          </div>
        ))}
        <div className="row">
          <button disabled={!plan || plan.total_bytes === 0} onClick={() => void start()}>
            Tải và cài
          </button>
          <button onClick={onDone}>Đóng</button>
        </div>
      </div>
    </div>
  );
}
