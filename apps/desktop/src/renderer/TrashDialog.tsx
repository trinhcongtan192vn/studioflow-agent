import { useEffect, useState } from 'react';
import { core } from './rpc';

type Entry = Awaited<ReturnType<typeof core.call<'trash.list'>>>['entries'][number];

const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

/** 064: thùng rác video của kênh — khôi phục, dọn hẳn (tự dọn sau 30 ngày). */
export function TrashDialog({
  channel,
  onChanged,
  onClose,
}: {
  channel: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string }>();
  const load = () =>
    void core
      .call('trash.list', { channel })
      .then((r) => setEntries(r.entries))
      .catch(() => setEntries([]));
  useEffect(load, [channel]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMsg({ tone: 'success', text: ok });
      load();
      onChanged();
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
  };

  return (
    <div className="modal" onClick={onClose}>
      <div
        className="card trash-dialog"
        role="dialog"
        aria-label="Thùng rác"
        data-testid="trash-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Thùng rác</h2>
        <p className="muted">
          Video đã xóa nằm ở đây 30 ngày rồi tự dọn hẳn. Khôi phục được trước khi dọn.
        </p>
        <ul className="list">
          {entries.map((e) => (
            <li key={e.trash_id} className="row">
              <span>
                <b>{e.title}</b> <span className="muted">· xóa {day(e.deleted_at)}</span>
              </span>
              <button
                className="link"
                onClick={() =>
                  void act(
                    () => core.call('trash.restore', { channel, trash_id: e.trash_id }),
                    `Đã khôi phục "${e.title}".`,
                  )
                }
              >
                Khôi phục
              </button>
            </li>
          ))}
          {!entries.length && <li className="muted">Thùng rác trống.</li>}
        </ul>
        {entries.length > 0 &&
          (confirmEmpty ? (
            <div className="row" role="alertdialog">
              <span className="error">
                Xóa hẳn {entries.length} video? Không khôi phục được nữa.
              </span>
              <button
                className="primary"
                onClick={() => {
                  setConfirmEmpty(false);
                  void act(() => core.call('trash.empty', { channel }), 'Đã dọn thùng rác.');
                }}
              >
                Xóa hẳn
              </button>
              <button className="link" onClick={() => setConfirmEmpty(false)}>
                Hủy
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmEmpty(true)}>Dọn thùng rác</button>
          ))}
        {msg && <p className={msg.tone === 'error' ? 'error' : 'success'}>{msg.text}</p>}
        <button onClick={onClose}>Đóng</button>
      </div>
    </div>
  );
}
