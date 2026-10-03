# Quickstart — 002 domain-artifacts

```powershell
node scripts/gen-contracts.mjs            # sinh docs/contracts/ từ D3–D11
node scripts/gen-contracts.mjs --check    # exit 1 nếu lệch (chạy trong verify)
npm run sf -- test contract               # schema + mẫu mỗi artifact

# Kênh mẫu
$ch = "packages/core/tests/fixtures/domain/channel"
npm run sf -- artifact validate $ch/videos/vd_8m2pq7rt/SCRIPT.md
npm run sf -- config resolve look.id --channel $ch --video vd_8m2pq7rt --scene sc_p0q2m5ka
npm run sf -- artifact migrate $ch/videos/vd_8m2pq7rt --dry-run

# Nghiệm thu SC-003 (1 000 lần giết giữa lúc ghi), trong packages/core
$env:SF_KILL_ITER=1000; npx vitest run tests/integration/atomic-kill.test.ts
```
