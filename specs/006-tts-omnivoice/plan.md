# Implementation Plan: TTS OmniVoice

**Branch**: `006-tts-omnivoice` | **Date**: 2026-10-03 | **Spec**: [spec.md](spec.md)

## Summary
Python: `workers/gpu/src/sf_worker/{rpc.py, engines/fake.py, engines/omnivoice.py, audio.py}` + lệnh `serve`. Node (`packages/core/src`): `workers/client.ts` (JSON-RPC stdio, pool theo engine), `providers/omnivoice.ts`, `providers/fake.ts`, `providers/index.ts` (đăng ký mặc định), `tts/builder.ts` (builder `audio.line`), `tts/tools.ts` (`voice.*`, `tts.synthesize`), CLI `video`, `tts`, `voice`. Manifest `extensions/providers/{tts.omnivoice,tts.fake}/provider.yaml`. Script dev `scripts/setup-engine.mjs`.

## Technical Context
**Language**: Python 3.12 (engine env), TypeScript/Node 22 · **Dependencies**: `omnivoice==0.2.1`, `torch==2.8.0+cu128`, `torchaudio==2.8.0+cu128` (engine env), không thêm phụ thuộc Node · **Storage**: `voices/<vo>/`, `audio/lines/`, cache 004 · **Testing**: pytest (giao thức, engine fake; `gpu` cho OmniVoice), Vitest (client với engine fake thật, provider fake, builder, tool, CLI), live (`SF_LLM=record` + `gpu`) cho AC-M0-01 · **Performance**: S1 ngưỡng ≤ 0,5× thời lượng audio, VRAM ≤ 6 GB.

## Constitution Check
- [x] I · [x] II/III (worker trong `workers/gpu`, logic điều phối trong `core`; CLI `sf video|tts|voice`) · [x] IV · [x] V (`TtsInput/Output`, `VoiceProfileInput/Output`, `ProviderManifest`, `AudioMeta`, `Provenance` từ `docs/contracts`) · [x] VI (worker chỉ ghi vào workdir tạm ngoài project; đầu ra vào project qua `runCapability`/`WriteStore`) · [x] VII (provenance mọi wav; log worker ra stderr) · [x] VIII · [x] IX (adapter provider là ranh giới đã định) · [x] X (OmniVoice thật với nhãn `gpu`; giả lập chỉ `tts.fake` khi `SF_GPU=0`).

## Project Structure
```text
extensions/providers/tts.omnivoice/provider.yaml
extensions/providers/tts.fake/provider.yaml
workers/gpu/src/sf_worker/{rpc.py,audio.py,engines/__init__.py,engines/fake.py,engines/omnivoice.py}
workers/gpu/tests/{contract/test_rpc.py,unit/test_audio.py,gpu/test_omnivoice.py}
packages/core/src/workers/client.ts
packages/core/src/providers/{omnivoice.ts,fake.ts,manifest.ts,index.ts}
packages/core/src/tts/{builder.ts,tools.ts}
packages/core/src/modules/{video,tts,voice}/cli.ts
scripts/setup-engine.mjs
```

## Complexity Tracking
Không có vi phạm.
