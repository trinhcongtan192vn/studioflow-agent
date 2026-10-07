// Giá trị mặc định của khóa cấu hình — tech-defaults.md mục 7 (không ràng buộc) và D4 mục 4.3.
// Đổi mặc định không phải đổi spec hệ thống (D3 mục 7.2).

export const DEFAULTS: Record<string, unknown> = {
  'output.profile': 'yt-1080p30',
  'workflow.default': 'narrated-explainer',
  'voice.id': null,
  'voice.pause_after_ms': 0,
  'look.id': 'neutral',
  'font.family': 'Be Vietnam Pro',
  'caption.style': 'caption-highlight',
  'caption.max_words': 7,
  'overlay.rules': [],
  'meta.hashtags': [],
  // D4 mục 4.3: phụ thuộc khóa API đã cấu hình → giải động ở 009.
  'text.producer': null,
  'text.critic': null,
  'text.aux': null,
  'refine.min_rounds': 2,
  'refine.max_rounds': 3,
  'refine.threshold': 8.0,
  'frame.min_duration_ms': 2000,
  'frame_build.parallel': 2,
  'budget.tokens_per_video': 2_000_000,
  'budget.api_cost_usd_per_video': 5,
  'budget.cache_gb': 20,
  'music.volume_db': -18,
  'music.duck_db': -12,
  'asr.max_regen': 1,
  'lipsync.enabled': false,
  // 034: chế độ tự động — chỉ dừng ở điểm chốt (brief luôn duyệt tay)
  'workflow.autopilot': true,
  'workflow.key_approvals': ['story', 'script', 'finalize'],
  'policy.auto_approve.batch_gen': false,
  'policy.auto_approve.paid_api': false,
  'check.duration_tolerance': 0.1,
  'meta.title_max': 100,
  'meta.description_max': 5000,
  'policy.batch.tts_lines': 20,
  'policy.batch.images': 5,
  'policy.paid_api.per_call_usd': 0.5,
  'policy.budget_warn_ratio': 0.8,
  'gpu.vram_total_gb': 14,
  // 047: Autopilot theo kênh (M6)
  'autopilot.enabled': false,
  'autopilot.paused': false,
  // 052: đóng cửa sổ khi có kênh Autopilot → ẩn xuống khay hệ thống, vẫn sản xuất
  'autopilot.background': true,
  'autopilot.competitors': [],
  'autopilot.pillars': [],
  'autopilot.workflows': [],
  'autopilot.max_per_day': 1,
  // 051: điểm tối thiểu của chủ đề được lập vào kế hoạch ngày
  'autopilot.min_score': 40,
  // 052: lệch thời lượng tối đa Autopilot tự bỏ qua cảnh báo audio_duration
  'autopilot.duration_waive_ratio': 0.25,
  'autopilot.work_window': '08:00-23:00',
  'autopilot.budget_share': 0.7,
  // 050: null = học từ lần chạm hạn mức Claude gần nhất (FN-050)
  'autopilot.daily_tokens': null,
  // 055: bot Telegram (chat_id rỗng = chưa đặt)
  'telegram.enabled': false,
  'telegram.chat_id': '',
  'telegram.allowed_user_ids': [],
  // 053: dự án API YouTube chưa kiểm duyệt → chỉ tải lên riêng tư, không hẹn giờ
  'publish.youtube.audited': false,
  'publish.platforms': ['youtube'],
  'publish.slots': ['19:00'],
  'publish.timezone': 'Asia/Ho_Chi_Minh',
  'publish.veto_hours': 2,
};

/** Khóa mẫu `<…>` → bảng con theo phần thay thế. */
export const PATTERN_DEFAULTS: Record<string, Record<string, unknown>> = {
  'asr.wer_threshold.<lang>': { vi: 0.15, de: 0.15, en: 0.15 },
  'gpu.vram_budget_gb.<engine>': { comfyui: 14, omnivoice: 6, asr: 3, render: 2 },
  'provider.<capability>': {
    'voice.profile': 'tts.omnivoice',
    'voice.design': 'tts.omnivoice',
    'tts.synthesize': 'tts.omnivoice',
    'asr.align': 'asr.hf-transcribe',
    'image.generate': 'image.qwen21-comfy',
    'image.edit': 'image.qwen21-comfy',
    'image.remove_bg': 'bg.hf-remove-background',
    'music.analyze': 'audio.analysis',
    'music.embed': 'audio.clap',
    'lipsync.cues': 'lipsync.amplitude',
    'grade.compare': 'hf.cli',
    'media.treatment': 'hf.cli',
    'render.video': 'render.hf-producer',
  },
};
