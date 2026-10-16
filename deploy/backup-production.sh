#!/usr/bin/env bash
set -euo pipefail
umask 077
backup_root=/srv/zjgsu-supervisor-v3/backups
mkdir -p "$backup_root"
chmod 700 "$backup_root"
backup_dir=$(mktemp -d "$backup_root/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
mysqldump --single-transaction --skip-lock-tables --no-tablespaces --set-gtid-purged=OFF zjgsu_v3_20261016 | gzip > "$backup_dir/database.sql.gz"
gzip -t "$backup_dir/database.sql.gz"
sha256sum "$backup_dir/database.sql.gz" > "$backup_dir/SHA256SUMS"
printf '%s\n' "$backup_dir"
