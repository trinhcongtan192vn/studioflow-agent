import { useEffect, useState } from 'react';
import type { PublishQueueItem } from '@studioflow/core';
import { mediaUrl } from './FileViewer';
import { Icon } from './Icon';
import { PLATFORM_LABEL, platformActions, platformState } from './publish-format';
import { core } from './rpc';
import { Surface } from './Surface';

type Platform = 'youtube' | 'tiktok' | 'facebook';
const GROUPS: { stage: PublishQueueItem['stage']; label: string; hint: string }[] = [
  { stage: 'pending', label: 'Chờ đăng', hint: 'Xem lại trước giờ công khai; hủy nếu chưa ổn.' },
  { stage: 'published', label: 'Đã đăng', hint: '' },
  { stage: 'stopped', label: 'Đã hủy / lỗi', hint: '' },
];

/**
 * 074: Duyệt trước khi đăng — video Autopilot đã làm xong: xem video, thông tin đăng, trạng thái từng nền tảng;
 * Đăng ngay / Hủy đăng trong giờ chờ phản đối. Sửa thông tin: mở video và nhờ agent.
 */
export function PublishReview({
  channel,
  onOpenVideo,
  onClose,
}: {
  channel: string;
  onOpenVideo: (id: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<PublishQueueItem[] | null>(null);
  const [playing, setPlaying] = useState<PublishQueueItem>();
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string }>();
  const load = () =>
    void core
      .call('publish.queue', { channel })
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  useEffect(() => {
    load();
    const off = core.on('publish.updated', (e) => {
      if (e.channel === channel) load();
    });
    return off;
  }, [channel]);

  const act = async (it: PublishQueueItem, pf: Platform, kind: 'now' | 'cancel') => {
    setBusy(`${it.item_id}:${pf}`);
    setMsg(undefined);
    try {
      const r = await core.call(kind === 'now' ? 'publish.now' : 'publish.cancel', {
        channel,
        date: it.date,
        item_id: it.item_id,
        platform: pf,
      });
      setMsg({
        tone: 'success',
        text:
          r.note ??
          (kind === 'now'
            ? `Đã đăng ngay lên ${PLATFORM_LABEL[pf]}.`
            : 'Đã hủy đăng — video ở lại riêng tư.'),
      });
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    } finally {
      setBusy('');
      load();
    }
  };

  return (
    <Surface
      label="Duyệt trước khi đăng"
      className="publish-review"
      testId="publish-review"
      onClose={onClose}
    >
      <div className="set-top">
        <h2>Duyệt trước khi đăng</h2>
        <button onClick={onClose}>Đóng</button>
      </div>
      <p className="muted">
        Video Autopilot làm xong được tải lên ở chế độ riêng tư rồi tự công khai đúng giờ nếu bạn
        không phản đối. Muốn sửa tiêu đề / mô tả: mở video và nhờ agent sửa trước giờ tải lên.
      </p>
      {msg && (
        <p className={msg.tone} role="status">
          {msg.text}
        </p>
      )}
      {items === null ? (
        <p className="muted">Đang tải…</p>
      ) : !items.length ? (
        <div className="empty-state">
          <Icon name="send" size={32} />
          <p>Chưa có video nào chờ đăng.</p>
          <p className="muted">
            Video do Autopilot làm xong sẽ hiện ở đây. Bật Autopilot và kết nối YouTube trong Cài
            đặt kênh.
          </p>
        </div>
      ) : (
        GROUPS.map((g) => {
          const list = items.filter((x) => x.stage === g.stage);
          if (!list.length) return null;
          return (
            <section key={g.stage} className="pr-group">
              <h3>
                {g.label} <span className="muted">{list.length}</span>
              </h3>
              {g.hint && <p className="muted">{g.hint}</p>}
              {list.map((it) => (
                <article
                  key={`${it.date}/${it.item_id}`}
                  className="pr-card"
                  data-testid="publish-item"
                >
                  <button
                    className={`lib-media${it.format === 'vertical' ? ' vertical' : ''}`}
                    aria-label={`Xem ${it.title}`}
                    disabled={!it.render}
                    onClick={() => setPlaying(it)}
                  >
                    {it.thumbnail ? (
                      <img src={mediaUrl(it.thumbnail)} alt="" loading="lazy" />
                    ) : (
                      <Icon name="film" size={28} />
                    )}
                    {it.render && (
                      <span className="lib-play">
                        <Icon name="play" size={22} />
                      </span>
                    )}
                  </button>
                  <div className="pr-body">
                    <b className="lib-title">{it.title}</b>
                    {it.meta?.description && <p className="pr-desc">{it.meta.description}</p>}
                    <div className="vc-meta">
                      {it.meta && it.meta.tags.length > 0 && (
                        <span className="muted">{it.meta.tags.length} thẻ</span>
                      )}
                      {it.meta && it.meta.chapters > 0 && (
                        <span className="muted">· {it.meta.chapters} chương</span>
                      )}
                      {!it.render && <span className="error">Chưa có bản render phát hành</span>}
                    </div>
                    <ul className="pr-platforms">
                      {it.platforms.map((pf) => {
                        const st = it.publish[pf as Platform];
                        const s = platformState(st, it.publish_at);
                        const a = platformActions(st);
                        const key = `${it.item_id}:${pf}`;
                        return (
                          <li key={pf} className={`pr-pf ${s.tone}`}>
                            <b>{PLATFORM_LABEL[pf] ?? pf}</b>
                            <span className="pr-state">{s.text}</span>
                            <span className="pr-actions">
                              {st?.url && (
                                <button
                                  className="ghost"
                                  onClick={() => void window.studioflow.openExternal(st.url!)}
                                >
                                  Xem
                                </button>
                              )}
                              {a.now && (
                                <button
                                  className="primary"
                                  disabled={busy === key}
                                  onClick={() => void act(it, pf as Platform, 'now')}
                                >
                                  Đăng ngay
                                </button>
                              )}
                              {a.cancel && (
                                <button
                                  className="danger"
                                  disabled={busy === key}
                                  onClick={() => void act(it, pf as Platform, 'cancel')}
                                >
                                  Hủy đăng
                                </button>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="row">
                      <button className="ghost" onClick={() => onOpenVideo(it.video_id)}>
                        Mở video
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </section>
          );
        })
      )}
      {playing?.render && (
        <div className="modal" onClick={() => setPlaying(undefined)}>
          <div className="card player" onClick={(e) => e.stopPropagation()}>
            <div className="set-top">
              <b>{playing.title}</b>
              <button onClick={() => setPlaying(undefined)}>Đóng</button>
            </div>
            <video src={mediaUrl(playing.render.file)} controls autoPlay />
          </div>
        </div>
      )}
    </Surface>
  );
}
