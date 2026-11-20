#!/bin/bash
# Deploys the committed HEAD to the server: builds the linux/amd64 image, pushes
# ghcr.io/deus42/capsula:sha-<commit>, then on the server installs compose.yaml and the backup script, pulls that
# exact image, restarts and waits for /health. A failed health check brings the previous tag back.
# Needs a clean tree, `docker login ghcr.io` with a token that can write packages, and SSH (over Tailscale) to a
# user with passwordless sudo for docker. Set DOCKER_CONTEXT when the default Docker context has no daemon.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: deploy.sh SSH_HOST" >&2
  exit 2
fi
remote=$1
case "$remote" in -*|*[!a-zA-Z0-9@._-]*) echo "Invalid SSH host." >&2; exit 2;; esac
cd "$(dirname "$0")/.."
if [ -n "$(git status --porcelain)" ]; then
  echo "Commit or stash changes first: the image is built from HEAD." >&2
  exit 1
fi
tag="sha-$(git rev-parse HEAD)"
image="ghcr.io/deus42/capsula:$tag"

docker buildx build --platform linux/amd64 --tag "$image" --push .

ssh_args=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15)
ssh "${ssh_args[@]}" "$remote" 'sudo -n install -d -m 755 /srv/capsula && sudo -n tee /srv/capsula/compose.yaml > /dev/null' < deploy/compose.yaml
ssh "${ssh_args[@]}" "$remote" 'sudo -n tee /usr/local/sbin/capsula-backup.new > /dev/null && sudo -n chmod 755 /usr/local/sbin/capsula-backup.new && sudo -n mv /usr/local/sbin/capsula-backup.new /usr/local/sbin/capsula-backup' < scripts/backup-snapshot.sh
ssh "${ssh_args[@]}" "$remote" bash -s -- "$tag" <<'REMOTE'
set -euo pipefail
tag=$1
cd /srv/capsula
previous=$(sudo -n sed -n 's/^CAPSULA_TAG=//p' .env 2>/dev/null || true)
sudo -n env CAPSULA_TAG="$tag" docker compose pull --quiet
echo "CAPSULA_TAG=$tag" | sudo -n tee .env > /dev/null
sudo -n docker compose up -d --remove-orphans
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:4317/health > /dev/null 2>&1; then
    echo "Healthy: $tag"
    exit 0
  fi
  sleep 2
done
echo "No healthy answer from $tag." >&2
sudo -n docker compose logs --tail 40 capsula >&2 || true
if [ -n "$previous" ]; then
  echo "CAPSULA_TAG=$previous" | sudo -n tee .env > /dev/null
  sudo -n docker compose up -d
  echo "Rolled back to $previous." >&2
fi
exit 1
REMOTE
