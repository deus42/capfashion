#!/bin/bash
# Installs the hourly encrypted backup pull on the recovery Mac: an age identity kept outside
# the repository, the pull script, and a LaunchAgent that runs it every hour (a snapshot is pulled once).
set -euo pipefail
umask 077
test "$(uname -s)" = Darwin
command -v age > /dev/null
command -v age-keygen > /dev/null
command -v python3 > /dev/null

if [ "$#" -ne 1 ]; then
  echo "Usage: install-mac-backup.sh SSH_HOST" >&2
  exit 2
fi
remote=$1
case "$remote" in -*|*[!a-zA-Z0-9@._-]*) echo "Invalid SSH host." >&2; exit 2;; esac
recovery="$HOME/Library/Application Support/Capsula/Recovery"
backups="$HOME/Library/Application Support/Capsula/Backups"
plist="$HOME/Library/LaunchAgents/local.capsula.backup-pull.plist"
source_dir=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$recovery" "$backups" "$(dirname "$plist")"
if [ -d "$backups/.pull.lock" ]; then
  echo "Wait for the running backup pull first." >&2
  exit 3
fi
[ -e "$recovery/identity.txt" ] || age-keygen -o "$recovery/identity.txt" > /dev/null 2>&1
install -m 700 "$source_dir/pull-backup.sh" "$recovery/pull-backup.sh"
python3 - "$plist" "$recovery" "$backups" "$remote" <<'PY'
import pathlib, plistlib, sys
target, recovery, backups, remote = sys.argv[1:]
pathlib.Path(target).write_bytes(plistlib.dumps({
    'Label': 'local.capsula.backup-pull',
    'ProgramArguments': ['/bin/bash', recovery + '/pull-backup.sh', remote, backups, recovery + '/identity.txt'],
    'EnvironmentVariables': {'PATH': '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'},
    'StartInterval': 3600, 'RunAtLoad': True, 'ProcessType': 'Background', 'LowPriorityIO': True,
    'StandardOutPath': recovery + '/pull.log', 'StandardErrorPath': recovery + '/pull.log',
}))
PY
launchctl bootout "gui/$(id -u)" "$plist" 2> /dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
echo "Hourly encrypted pull installed. Keep a second copy of $recovery/identity.txt somewhere safe: without it the backups cannot be read."
