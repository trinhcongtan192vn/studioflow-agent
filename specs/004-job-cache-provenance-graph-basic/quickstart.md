# Quickstart — 004

```powershell
$ch = "packages/core/tests/fixtures/domain/channel"
npm run sf -- graph status --channel $ch --video vd_8m2pq7rt   # mọi nút missing (chưa build)
npm run sf -- graph plan --channel $ch --video vd_8m2pq7rt     # job theo pha tts → asr → assemble
npm run sf -- job list

# trong packages/core
npx vitest run tests/integration/jobs.test.ts tests/integration/graph.test.ts tests/integration/capability.test.ts
```
