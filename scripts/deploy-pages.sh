#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
cd "$repo_root"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing to deploy an uncommitted worktree." >&2
  exit 1
fi

readonly project_name="${NATIVE_GB_PAGES_PROJECT:-native-gb-web}"
readonly wrangler_version="4.110.0"
commit_hash="$(git rev-parse HEAD)"
commit_message="$(git log -1 --format=%s)"

npm ci
./scripts/build-tetris.sh
./scripts/build-sml.sh
./scripts/check.sh

if ! npx --yes "wrangler@${wrangler_version}" pages project list --json |
    python3 -c 'import json, sys; projects = json.load(sys.stdin); raise SystemExit(not any(project.get("Project Name") == sys.argv[1] for project in projects))' "$project_name"; then
  npx --yes "wrangler@${wrangler_version}" pages project create "$project_name" \
    --production-branch main
fi

npx --yes "wrangler@${wrangler_version}" pages deploy site \
  --project-name "$project_name" \
  --branch main \
  --commit-hash "$commit_hash" \
  --commit-message "$commit_message" \
  --commit-dirty=false
