#!/usr/bin/env bash
# CI: start `supabase functions serve` in the background and warm up create-user.
# "Serving functions" only means the runtime listens; the first request still boots an
# isolate and resolves npm deps. On a cold GitHub runner that first boot can hang for
# minutes (PR #65: the first two create-user calls were killed by the wall-clock limit),
# so the e2e that happened to call it first failed. A request with the anon key boots the
# isolate and goes through getUser (401) — after that the tests hit a warm function.
set -euo pipefail

supabase functions serve > functions.log 2>&1 &
for _ in $(seq 1 60); do grep -q "Serving functions" functions.log && break; sleep 3; done
grep -q "Serving functions" functions.log || { cat functions.log; exit 1; }

eval "$(supabase status -o env)"
for i in $(seq 1 10); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 -X POST \
    "$API_URL/functions/v1/create-user" \
    -H "Authorization: Bearer $ANON_KEY" -H 'content-type: application/json' -d '{}' || true)
  if [ "$code" = 401 ]; then
    echo "create-user is warm (attempt $i)"
    exit 0
  fi
  echo "create-user warm-up attempt $i: HTTP $code"
  sleep 2
done
echo "create-user did not warm up after 10 attempts"
cat functions.log
exit 1
