#!/bin/sh
# Runs the visual tests in the pinned Linux image.
# Pass --update-snapshots to regenerate baselines for review.
set -e
docker build -t xl-viewer-visual -f tests/visual.Dockerfile .
mkdir -p apps/playground/tests/__screenshots__ test-results
docker run --rm --ipc=host \
  -v "$PWD/apps/playground/tests/__screenshots__:/work/apps/playground/tests/__screenshots__" \
  -v "$PWD/test-results:/work/test-results" \
  xl-viewer-visual pnpm exec playwright test "$@"
