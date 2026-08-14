#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
check() { local label="$1"; shift; if "$@"; then printf 'PASS  %s\n' "$label"; else printf 'FAIL  %s\n' "$label"; fail=1; fi; }
clean_tree() { test -z "$(git status --porcelain=v1)"; }
no_latest() { ! grep -Eq '^[[:space:]]+image:[[:space:]].*:latest([[:space:]]|$)' docker-stack.yml; }
no_plaintext_secrets() { ! grep -En '^[[:space:]]+(DATABASE_CONNECTION_URI|AUTHENTICATION_API_KEY|PASSWORD|API_KEY):[[:space:]]+[^$<{]' docker-stack.yml; }
check 'working tree limpa' clean_tree
check 'stack sem imagens :latest' no_latest
check 'stack sem segredos evidentes em texto' no_plaintext_secrets
check 'Caddy v?lido' caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
check 'backend tests' timeout 600 bash -lc 'cd vsaas-backend && npm test -- --run --reporter=dot >/tmp/vsaas-preflight-tests.log 2>&1'
check 'backend build e gates' timeout 600 bash -lc 'cd vsaas-backend && npm run build >/tmp/vsaas-preflight-backend.log 2>&1'
check 'frontend build' timeout 600 bash -lc 'cd vsaas-frontend && npm run build >/tmp/vsaas-preflight-frontend.log 2>&1'
printf '\nrelease_preflight=%s\n' "$([ "$fail" -eq 0 ] && echo PASS || echo FAIL)"
exit "$fail"
