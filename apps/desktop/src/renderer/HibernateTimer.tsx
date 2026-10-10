import { useEffect, useRef, useState } from 'react';
import {
  clampMinutes,
  HIBERNATE_COUNTDOWN_S,
  hibernateLabel,
  idleTick,
  isBusy,
  type IdleTick,
} from './hibernate-format';
import { core } from './rpc';

const POLL_MS = 15_000;
const KEY = 'sf.hibernate.minutes';

const savedMinutes = (): number => {
  try {
    return clampMinutes(localStorage.getItem(KEY) ?? 15);
  } catch {
    return 15;
  }
};

/**
 * Hẹn giờ ngủ đông máy (2026-10-10): bật ở thanh dưới; khi app rảnh liên tục X phút (không bước/job/agent nào
 * chạy) thì đếm ngược 60 s rồi ngủ đông. Bật một lần cho phiên này — ngủ đông xong là tự tắt.
 */
export function HibernateTimer() {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [minutes, setMinutes] = useState(savedMinutes);
  const [tick, setTick] = useState<IdleTick | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idleSince = useRef<number | null>(null);

  // theo dõi việc khi đã bật
  useEffect(() => {
    if (!armed) {
      idleSince.current = null;
      setTick(null);
      return;
    }
    let stop = false;
    const check = async () => {
      let busy = true;
      try {
        busy = isBusy(await core.call('app.activity', {}));
      } catch {
        /* lõi đang khởi động lại → coi như còn việc */
      }
      if (stop) return;
      const t = idleTick(idleSince.current, busy, Date.now(), minutes);
      idleSince.current = t.idleSince;
      setTick(t);
      if (t.due) setCountdown((c) => c ?? HIBERNATE_COUNTDOWN_S);
    };
    void check();
    const timer = window.setInterval(() => void check(), POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [armed, minutes]);

  // đếm ngược trước khi ngủ đông
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      setArmed(false);
      void window.studioflow.hibernate().then((r) => {
        if (!r.ok) setError(r.error ?? 'không ngủ đông được');
      });
      return;
    }
    const t = window.setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => window.clearTimeout(t);
  }, [countdown]);

  const apply = (on: boolean) => {
    try {
      localStorage.setItem(KEY, String(minutes));
    } catch {
      /* chỉ là ghi nhớ số phút */
    }
    idleSince.current = null;
    setError(null);
    setArmed(on);
    setOpen(false);
  };

  return (
    <span className="hibernate">
      <button
        className="linkish"
        data-testid="hibernate-toggle"
        title="Hẹn giờ ngủ đông máy sau khi xong hết việc"
        onClick={() => setOpen(!open)}
      >
        ⏾ {hibernateLabel(armed, minutes, tick)}
      </button>
      {error && <span className="error"> {error}</span>}
      {open && (
        <div className="hibernate-pop card" role="dialog" aria-label="Hẹn giờ ngủ đông">
          <label>
            Ngủ đông máy khi xong hết việc của mọi video, sau{' '}
            <input
              type="number"
              min={1}
              max={720}
              value={minutes}
              data-testid="hibernate-minutes"
              onChange={(e) => setMinutes(clampMinutes(e.target.value))}
            />{' '}
            phút
          </label>
          <p className="muted">
            “Xong việc” = không còn bước, job (đang chạy hay xếp hàng) hay agent nào đang chạy. Bước
            đang chờ bạn duyệt không tính là việc. Trước khi ngủ đông có {HIBERNATE_COUNTDOWN_S}{' '}
            giây để hủy.
          </p>
          <div className="row">
            <button className="primary" data-testid="hibernate-on" onClick={() => apply(true)}>
              {armed ? 'Cập nhật' : 'Bật'}
            </button>
            {armed && <button onClick={() => apply(false)}>Tắt</button>}
            <button onClick={() => setOpen(false)}>Đóng</button>
          </div>
        </div>
      )}
      {countdown !== null && (
        <div
          className="modal"
          role="alertdialog"
          aria-label="Sắp ngủ đông"
          data-testid="hibernate-guard"
        >
          <div className="card">
            <h3>Sắp ngủ đông máy</h3>
            <p>
              Đã xong hết việc {minutes} phút. Máy sẽ ngủ đông sau <b>{countdown}</b> giây.
            </p>
            <div className="row">
              <button
                className="primary"
                data-testid="hibernate-cancel"
                onClick={() => {
                  setCountdown(null);
                  setArmed(false);
                }}
              >
                Hủy (tắt hẹn giờ)
              </button>
              <button onClick={() => setCountdown(0)}>Ngủ đông ngay</button>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
