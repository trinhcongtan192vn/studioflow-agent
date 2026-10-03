# Contract — báo cáo `npm run verify`

In bảng người đọc được ra stdout, đồng thời ghi `verify-report.json` ở gốc repo (bị `.gitignore`):

```json
{
  "ok": false,
  "projects": [
    { "name": "packages/core", "steps": [ { "step": "build|lint|test", "ok": true, "ms": 1234, "detail": "..." } ] }
  ]
}
```

- Mã thoát 0 khi mọi bước của mọi project `ok`; ngược lại 1.
- Một bước hỏng không làm dừng các project khác (để báo cáo đủ), nhưng các bước sau trong cùng project vẫn chạy.
- `detail` của bước hỏng chứa phần cuối đầu ra (≤ 4 KB) để chỉ ra test/file hỏng.
