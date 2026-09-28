#!/usr/bin/env bash
# Reconstructs server/wrangler.toml from wrangler.toml.example at CI build
# time. wrangler.toml itself is deliberately git-ignored (see CLAUDE.md) so
# a fork of this open-source repo never accidentally ends up pointed at
# this account's real D1 database or custom domain — but Cloudflare Workers
# Builds checks out a fresh clone each run, so something has to produce a
# real wrangler.toml before `wrangler deploy` can read it. This fills in
# the two account-specific placeholders from Cloudflare Build's own
# environment variables (set in the dashboard when you connect the repo,
# never committed), leaving everything else exactly as the template has it.
#
# Required env vars (set as Cloudflare Build "Build variables", not
# secrets — neither of these is sensitive on its own):
#   WRANGLER_D1_DATABASE_ID   e.g. `wrangler d1 info dams_db` locally
#   WRANGLER_CUSTOM_DOMAIN    e.g. memory.example.com
set -euo pipefail
cd "$(dirname "$0")/.."

: "${WRANGLER_D1_DATABASE_ID:?Set this as a Cloudflare Build environment variable}"
: "${WRANGLER_CUSTOM_DOMAIN:?Set this as a Cloudflare Build environment variable}"

sed \
  -e "s/<YOUR_D1_DATABASE_ID>/${WRANGLER_D1_DATABASE_ID}/" \
  -e "s/memory\.example\.com/${WRANGLER_CUSTOM_DOMAIN}/" \
  wrangler.toml.example > wrangler.toml

echo "Wrote server/wrangler.toml for ${WRANGLER_CUSTOM_DOMAIN}"
