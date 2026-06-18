#!/bin/sh
echo "=== START ==="
cd /app
npm ci --registry https://registry.npmmirror.com --legacy-peer-deps 2>&1 | tail -5
echo "=== VITEST START ==="
npx vitest run src/components/__tests__/HistoryRecordSelectModal.test.tsx 2>&1
echo "=== VITEST EXIT=$? ==="
