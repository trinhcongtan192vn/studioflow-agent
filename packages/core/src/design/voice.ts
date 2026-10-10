import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Nhịp đọc của design kênh: tốc độ TTS (1 = tốc độ của giọng mẫu) và khoảng nghỉ sau mỗi câu. */
export interface DesignVoice {
  /** 0.8–1.2; truyền thẳng vào TTS (OmniVoice `speed`). */
  speed: number;
  /** 0–1500 ms; nghỉ sau mỗi câu khi `voice.pause_after_ms` không đặt riêng. */
  pause_ms: number;
}

export const DEFAULT_VOICE: DesignVoice = { speed: 1, pause_ms: 0 };

export function normalizeVoice(v: Partial<DesignVoice> | undefined): DesignVoice {
  const speed = Number(v?.speed);
  const pause = Number(v?.pause_ms);
  return {
    speed: Number.isFinite(speed) ? Math.round(Math.min(1.2, Math.max(0.8, speed)) * 100) / 100 : 1,
    pause_ms: Number.isFinite(pause) ? Math.round(Math.min(1500, Math.max(0, pause))) : 0,
  };
}

/** Nhịp đọc trong `profile/design-system.json` của kênh; chưa có design → tốc độ giọng mẫu, không nghỉ. */
export function readDesignVoice(channelDir: string): DesignVoice {
  try {
    const d = JSON.parse(
      readFileSync(path.join(channelDir, 'profile', 'design-system.json'), 'utf8'),
    ) as { voice?: Partial<DesignVoice> };
    return normalizeVoice(d.voice);
  } catch {
    return DEFAULT_VOICE;
  }
}
