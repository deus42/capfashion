#!/bin/bash
# Run on the recovery Mac (production spec §8, after AllCheck's encrypted off-host copy): pulls the newest server
# snapshot over SSH, encrypts it with age as it arrives, decrypts it back through a SHA-256 check and keeps
# 7 daily and 4 weekly copies. Neither plaintext nor the age identity reaches the server; the previous copies stay
# untouched when anything fails. Requires age, ssh, shasum and Python 3.
set -euo pipefail
umask 077

if [ "$#" -ne 3 ]; then
  echo "Usage: pull-backup.sh SSH_HOST BACKUP_DIRECTORY AGE_IDENTITY" >&2
  exit 2
fi
remote=$1
backup_dir=$2
identity=$3
remote_dir=/srv/capsula/backups
case "$remote" in -*|*[!a-zA-Z0-9@._-]*) echo "Invalid SSH host." >&2; exit 2;; esac
test -r "$identity"
mkdir -p "$backup_dir"
lock="$backup_dir/.pull.lock"
if ! mkdir "$lock" 2>/dev/null; then
  echo "Another backup pull is running (or a stale .pull.lock needs inspection)." >&2
  exit 3
fi
temporary=
cleanup() {
  [ -z "$temporary" ] || rm -f "$temporary"
  rmdir "$lock"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

ssh_args=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3)
filename=$(ssh "${ssh_args[@]}" "$remote" "sudo -n find $remote_dir -maxdepth 1 -type f -name 'capsula-*.tar' -printf '%f\\n' | sort | tail -n 1")
if [[ ! "$filename" =~ ^capsula-[0-9]{8}T[0-9]{6}Z\.tar$ ]]; then
  echo "No completed snapshot was found on the server." >&2
  exit 1
fi
# A nightly snapshot older than 30 hours means the server's timer stopped.
if ! python3 -c 'import datetime, sys; t = datetime.datetime.strptime(sys.argv[1], "capsula-%Y%m%dT%H%M%SZ.tar").replace(tzinfo=datetime.timezone.utc); sys.exit(0 if datetime.timedelta(minutes=-5) < datetime.datetime.now(datetime.timezone.utc) - t < datetime.timedelta(hours=30) else 1)' "$filename"; then
  echo "The newest server snapshot is older than 30 hours or has an invalid time." >&2
  exit 1
fi

destination="$backup_dir/$filename.age"
if [ -s "$destination" ] && [ -s "$destination.verified" ]; then
  expected=$(sed -n 's/^sha256=//p' "$destination.verified")
  actual=$(age --decrypt -i "$identity" "$destination" | shasum -a 256 | cut -d ' ' -f 1)
  [ "$actual" = "$expected" ] || { echo "The kept copy of $filename failed verification." >&2; exit 1; }
  echo "Already kept and verified: $filename"
else
  expected=$(ssh "${ssh_args[@]}" "$remote" "sudo -n cat '$remote_dir/$filename.sha256'")
  if [[ ! "$expected" =~ ^[a-f0-9]{64}$ ]]; then
    echo "Invalid source checksum." >&2
    exit 1
  fi
  temporary=$(mktemp "$backup_dir/.pull.XXXXXX")
  ssh "${ssh_args[@]}" "$remote" "sudo -n cat '$remote_dir/$filename'" | age --encrypt -i "$identity" > "$temporary"
  actual=$(age --decrypt -i "$identity" "$temporary" | shasum -a 256 | cut -d ' ' -f 1)
  if [ "$actual" != "$expected" ]; then
    echo "Backup verification failed; the kept copies are unchanged." >&2
    exit 1
  fi
  mv "$temporary" "$destination"
  temporary=
  printf 'sha256=%s\nsource=%s\nverified_at=%s\n' "$actual" "$filename" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$destination.verified"
  echo "Encrypted and verified: $filename"
fi

# Keep the newest copy of each of the last 7 days and of each of the last 4 ISO weeks; only verified copies
# count, and nothing else in the folder is touched.
python3 - "$backup_dir" <<'PY'
import datetime, pathlib, re, sys
folder = pathlib.Path(sys.argv[1])
copies = sorted((p for p in folder.glob('capsula-*.tar.age') if re.fullmatch(r'capsula-\d{8}T\d{6}Z\.tar\.age', p.name)
                 and (folder / (p.name + '.verified')).is_file()), reverse=True)
when = lambda p: datetime.datetime.strptime(p.name[8:24], '%Y%m%dT%H%M%SZ')
days, weeks, keep = [], [], set()
for p in copies:
    day, week = when(p).date(), when(p).isocalendar()[:2]
    if day not in days and len(days) < 7: days.append(day); keep.add(p)
    if week not in weeks and len(weeks) < 4: weeks.append(week); keep.add(p)
for p in copies:
    if p not in keep:
        p.unlink()
        (folder / (p.name + '.verified')).unlink()
        print('Removed', p.name)
PY
