#!/usr/bin/env bash
# Builds clineshield-eval:<short-sha> from the committed HEAD (uncommitted changes are not included).
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
SHA="$(git -C "$ROOT" rev-parse --short HEAD)"
CTX="$(mktemp -d)"
trap 'rm -rf "$CTX"' EXIT
mkdir -p "$CTX/repo"
git -C "$ROOT" archive HEAD | tar -x -C "$CTX/repo"
echo "$SHA" > "$CTX/repo/eval/BUILD_SHA"
cp "$ROOT/eval/docker/Dockerfile" "$CTX/Dockerfile"
docker build -t "clineshield-eval:$SHA" "$CTX"
echo "built clineshield-eval:$SHA"
echo "log in once (owner): docker run -it --rm --user eval -e HOME=/home/eval -v clineshield-eval-cline:/home/eval/.cline clineshield-eval:$SHA cline auth"
