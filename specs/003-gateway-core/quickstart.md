# Quickstart — 003 gateway-core

```powershell
$ch = "packages/core/tests/fixtures/domain/channel"
npm run sf -- gateway tools --kind frame          # tool được phép cho phiên frame
npm run sf -- gateway serve --channel $ch --video vd_8m2pq7rt --kind main
# → {"url":"http://127.0.0.1:<port>/mcp","token":"..."}; kết nối bằng MCP client với header Authorization: Bearer <token>

# trong packages/core
npx vitest run tests/contract/gateway-policy.test.ts tests/integration/gateway-adversarial.test.ts
```
