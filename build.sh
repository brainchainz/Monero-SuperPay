#!/bin/bash
set -e

IMAGE="sirjamzalot/monero-superpay:latest"

echo "=== Monero SuperPay — Local Build & Push ==="
echo "Image: $IMAGE"
echo ""
echo "This builds for YOUR machine's architecture only."
echo "For multi-arch (amd64+arm64), push to GitHub and"
echo "the CI workflow builds both automatically."
echo ""

docker build -t "$IMAGE" .
echo ""

read -p "Push to Docker Hub? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
  docker push "$IMAGE"
  echo ""
  echo "Pushed! Restart the app on Umbrel to pull the new image."
else
  echo "Skipped push. Image is available locally as: $IMAGE"
fi
