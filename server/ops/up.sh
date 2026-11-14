#!/bin/sh
# Build and start the local Docker stack with the code identity baked in (WS12 O1, D57, D69).
#   flock /tmp/hl-heavy.lock sg docker -c "server/ops/up.sh"      # from the repo root
# Extra arguments go to `docker compose up` (default: -d --build).
#
# The image reports HL_COMMIT / HL_ENGINE_TREE at /engine/version and in every result hash, so
# they must describe the files copied into it: uncommitted or untracked changes in the image paths
# stop the build. HL_ALLOW_DIRTY=1 builds anyway WITHOUT an identity (/engine/version then answers
# 503 engine_identity_unavailable; nothing invented).
set -eu
cd "$(git rev-parse --show-toplevel)"
dirty=$(git status --porcelain --untracked-files=all -- \
  .dockerignore pyproject.toml uv.lock config contracts pipeline server tools web/public/data)
if [ -n "$dirty" ]; then
  if [ "${HL_ALLOW_DIRTY:-}" != 1 ]; then
    echo "up.sh: uncommitted changes in the image paths; commit them or set HL_ALLOW_DIRTY=1:" >&2
    echo "$dirty" >&2
    exit 1
  fi
  echo "up.sh: dirty tree, building WITHOUT code identity (HL_ALLOW_DIRTY=1)" >&2
  HL_COMMIT="" HL_ENGINE_TREE=""
else
  HL_COMMIT=$(git rev-parse HEAD) HL_ENGINE_TREE=$(git rev-parse HEAD:pipeline)
fi
export HL_COMMIT HL_ENGINE_TREE
if [ $# -eq 0 ]; then set -- -d --build; fi
exec docker compose -f server/ops/compose.yaml up "$@"
