#!/bin/bash
# Restores one encrypted copy from pull-backup.sh into an empty folder and checks it (production spec §8, A10):
# the SHA-256 recorded when it was pulled, SQLite integrity, and every account's db.json. Point the app at the
# folder with CAPSULA_DATA_DIR to look inside (deploy/README.md). Requires age, shasum, sqlite3 and Node.
set -euo pipefail
umask 077

if [ "$#" -ne 3 ]; then
  echo "Usage: restore-backup.sh COPY.tar.age AGE_IDENTITY EMPTY_DIRECTORY" >&2
  exit 2
fi
archive=$1
identity=$2
target=$3
expected=$(sed -n 's/^sha256=//p' "$archive.verified")
if [ -e "$target" ] && [ -n "$(ls -A "$target")" ]; then
  echo "$target is not empty." >&2
  exit 1
fi
mkdir -p "$target"
age --decrypt -i "$identity" "$archive" > "$target/.snapshot.tar"
actual=$(shasum -a 256 "$target/.snapshot.tar" | cut -d ' ' -f 1)
if [ "$actual" != "$expected" ]; then
  rm -f "$target/.snapshot.tar"
  echo "The copy does not match its recorded SHA-256." >&2
  exit 1
fi
tar -xf "$target/.snapshot.tar" -C "$target"
rm -f "$target/.snapshot.tar"
for db in "$target"/*.sqlite; do
  [ "$(sqlite3 "$db" 'PRAGMA integrity_check;')" = ok ] || { echo "$(basename "$db") failed its integrity check." >&2; exit 1; }
done
node -e '
const fs = require("fs"), path = require("path");
const users = path.join(process.argv[1], "users");
const ids = fs.existsSync(users) ? fs.readdirSync(users).filter((d) => /^[A-Za-z0-9_-]{6,64}$/.test(d) && fs.existsSync(path.join(users, d, "db.json"))) : [];
let photos = 0, looks = 0;
for (const id of ids) { const db = JSON.parse(fs.readFileSync(path.join(users, id, "db.json"), "utf8")); photos += db.photos.length; looks += db.looks.length; }
console.log(JSON.stringify({ restored: process.argv[1], accounts: ids.length, photos, looks }));
' "$target"
