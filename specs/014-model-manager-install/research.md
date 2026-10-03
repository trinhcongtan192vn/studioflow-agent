# Research — 014

## R1. Checksum và ghim
- GitHub release cung cấp `digest: sha256:…` cho asset (whisper.cpp b5130, uv 0.12.23, FFmpeg BtbN autobuild); Hugging Face cung cấp `lfs.oid` (sha256) cho file LFS; file git nhỏ của OmniVoice: tải ở commit ghim `c5fdb5c…` rồi tính sha256. URL dùng commit/tag cố định. Rủi ro: tag `autobuild-*` của BtbN có thể bị xóa → FFmpeg `satisfied_by_path` (máy có sẵn FFmpeg thì không tải); cập nhật danh mục khi đổi.

## R2. OmniVoice tải vào cache Hugging Face
- File đặt đúng bố cục `models/hf/hub/models--k2-fsa--OmniVoice/snapshots/<rev>/…` + `refs/main` → `OmniVoice.from_pretrained("k2-fsa/OmniVoice")` với `HF_HOME` dùng ngay, không tải lại; bản đã cài ở 006 cùng revision → coi là `installed`.

## R3. Whisper model
- Đặt thẳng vào `providers/whisper/home/.cache/hyperframes/whisper/models/` (nơi `hyperframes transcribe` đọc với home riêng, 010).

## R4. Credential Manager không cần module native
- PowerShell `Add-Type` P/Invoke `CredReadW/CredWriteW/CredDeleteW` (credential generic, persist local machine). Script truyền bằng `-EncodedCommand`, bí mật qua stdin (base64), giá trị đọc ra base64 → không lộ trên dòng lệnh/log. ~0,7 s mỗi lệnh (biên dịch kiểu); giá trị nhớ trong tiến trình.
- Test chạy kín (`SF_NO_CREDMAN=1`) trừ test credman.

## R5. Giải nén
- `System32\tar.exe` (bsdtar) — GNU tar của Git trên PATH không đọc zip.
