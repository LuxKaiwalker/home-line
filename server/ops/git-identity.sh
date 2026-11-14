#!/bin/sh
# Stand-in for `git` inside the HOMELINE API image (installed as /usr/local/bin/git; the image has
# no git and no .git). server/engine/version.py asks git for exactly two values (D57 identity):
#   git rev-parse HEAD           -> $HL_COMMIT       (baked at build time: --build-arg HL_COMMIT)
#   git rev-parse HEAD:pipeline  -> $HL_ENGINE_TREE  (baked at build time: --build-arg HL_ENGINE_TREE)
# Anything else, or a value that is not a 40-hex object id, fails like git does, so the API answers
# 503 engine_identity_unavailable instead of reporting an invented identity.
# Interim: the WS11 change asked for in server/ops/README.md (version.py reads HL_COMMIT /
# HL_ENGINE_TREE itself) makes this shim unnecessary.
set -eu
case "$*" in
  "rev-parse HEAD") v="${HL_COMMIT:-}" ;;
  "rev-parse HEAD:pipeline") v="${HL_ENGINE_TREE:-}" ;;
  *) echo "git (image shim): unsupported command: git $*" >&2; exit 129 ;;
esac
if ! printf '%s' "$v" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "git (image shim): '$*' unknown: the image was built without HL_COMMIT/HL_ENGINE_TREE" >&2
  exit 128
fi
printf '%s\n' "$v"
