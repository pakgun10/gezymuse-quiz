#!/usr/bin/env bash
# Backup harian MISI GEOMETRI: database SQLite (VACUUM INTO agar konsisten).
# Tidak ada file unggahan di aplikasi ini — cukup database-nya.
#
# Cron harian (root):
#   0 3 * * * DATA_DIR=/var/lib/gezymuse-quiz BACKUP_DIR=/var/backups/gezymuse-quiz /opt/gezymuse-quiz/deploy/backup.sh >> /var/log/gezymuse-quiz-backup.log 2>&1
set -euo pipefail

DATA_DIR="${DATA_DIR:-/var/lib/gezymuse-quiz}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/gezymuse-quiz}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [ ! -f "$DATA_DIR/misi-geometri.sqlite" ]; then
  echo "ERROR: database tidak ditemukan di $DATA_DIR/misi-geometri.sqlite" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%F_%H%M)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

SRC_DB="$DATA_DIR/misi-geometri.sqlite" DEST_DB="$WORK/misi-geometri.sqlite" bun -e "
import { Database } from 'bun:sqlite';
const db = new Database(process.env.SRC_DB, { readonly: true });
db.query('VACUUM INTO ?').run(process.env.DEST_DB);
db.close();
"

tar -czf "$BACKUP_DIR/gezymuse-quiz-$STAMP.tar.gz" -C "$WORK" .
find "$BACKUP_DIR" -name 'gezymuse-quiz-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete

echo "OK: $BACKUP_DIR/gezymuse-quiz-$STAMP.tar.gz ($(du -h "$BACKUP_DIR/gezymuse-quiz-$STAMP.tar.gz" | cut -f1))"
