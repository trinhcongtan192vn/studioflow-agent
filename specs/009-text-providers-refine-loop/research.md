# Research — 009

## R1. `text.claude` không cần khóa API
- **Decision**: `query()` của Agent SDK với `settingSources: []`, `allowedTools: []`, `maxTurns: 1`, `systemPrompt` = thông điệp `system` của yêu cầu, prompt = các thông điệp user/assistant ghép lại; lấy `result.result`, `usage`, `total_cost_usd`. Dùng đăng nhập gói Claude (005 R1). Chi phí SDK báo là quy đổi, vẫn cộng vào ngân sách để hiển thị nhất quán.

## R2. Model mặc định `[chờ S14]`
- producer `claude/claude-sonnet-5-5`, critic `claude/claude-opus-5-5`, aux `claude/claude-haiku-4-5`. Có `OPENAI_API_KEY` → producer `openai/gpt-5`; aux rẻ nhất có khóa (haiku nếu chỉ Claude).

## R3. Định dạng đầu ra producer
- Kịch bản: producer trả **thân** `SCRIPT.md` theo marker D3 5.4 (`## <beat> <!-- sf:beat -->`, `<!-- sf:line speaker=narrator -->` + đoạn văn, `<!-- sf:tts text="…" -->` khi cần); engine thêm front matter, gán ID (`assignScriptIds`), kiểm schema + kiểm khách quan. Sửa vòng sau giữ ID có sẵn (producer nhận bản có ID).
- Meta: producer trả JSON `{title, description, tags[]}`; engine ghi `publish.md`, chương lấy từ beat + `audio_meta.json` nếu có (không có → chương theo thứ tự beat, mốc 0).

## R4. Hỏi ngân sách
- `PermissionBus` chỉ có đồng ý/từ chối: đồng ý = chạy (kể cả khi không đủ `min` vòng), từ chối = hủy bước (`E_BUDGET_EXCEEDED`). Cạn giữa chừng → `incomplete`, quyết định ở thẻ duyệt.

## R5. Ghi/phát lại
- Khóa bản ghi = `{capability, provider, model, input}` (không đường dẫn). Thư mục: `SF_LLM_FIXTURES` hoặc tham số; test refine dùng `tests/fixtures/llm/text/`.

## R6. ID tất định cho bản nháp LLM
- **Decision**: khi engine gán ID cho line/beat do producer viết, dùng `seededId` (sha256 của bản nháp đầy đủ + thứ tự) thay vì ngẫu nhiên — cùng câu trả lời → cùng ID → prompt `revise`/`review` vòng sau trùng khóa bản ghi (D12). ID vẫn đúng mẫu D3 mục 2 và tránh ID đã có.

## R7. Chương trong `publish.md`
- **Decision** (lệch nhẹ R3): mốc chương ước theo số từ/`script.wpm.<lang>` + `pause_after_ms` của line trong beat (chưa có audio ở bước này); 010/013 có thể cập nhật mốc thật từ `audio_meta.json`.

## R8. Kết quả live (AC-M1-02, 2026-10-04)
- Producer `claude-sonnet-5-5`, critic `claude-opus-5-5` (cùng hãng → ghi chú trên thẻ duyệt); 2 vòng, ~2 phút; bản ghi `tests/fixtures/llm/text/` (6 lời gọi) phát lại xanh.
