# Deployment (Ubuntu VPS, nginx, Let's Encrypt, PostgreSQL)

How to run ASMS on one cloud server: **Ubuntu 24.04 LTS**, **nginx** in front,
**HTTPS from Let's Encrypt**, **PostgreSQL on the same server**, the API under
**systemd**. One domain (PHASE2_PLAN D8): the app at `/`, the API at `/api`.
Nothing here has been deployed yet; this is the checklist for doing it.

```
browser ──HTTPS──> nginx :443 ──┬── /        → /var/www/asms (asms-web/dist, fallback index.html)
                                └── /api/... → Express 127.0.0.1:3000 ──> PostgreSQL 127.0.0.1:5432
                                                     └── uploads: /var/lib/asms/uploads/documents
```

Throughout, `school.example.et` stands for the real domain.

## 1. Server

- A VPS with 2 vCPU, 2–4 GB RAM and 40 GB disk is enough for one school.
- A DNS `A` record for the domain pointing at the server (needed before §6).
- Log in as a sudo user (not root), then:

```bash
sudo apt update && sudo apt upgrade -y
sudo timedatectl set-timezone Africa/Addis_Ababa    # "today", due dates and attendance use local time
sudo apt install -y nginx git curl ufw
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable   # 22, 80, 443 only
```

**Node.js 22 LTS** (what development and the tests use), from NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

**PostgreSQL 18** (same major version as development, so `pg_dump`/`pg_restore`
files move both ways), from the PostgreSQL apt repository:

```bash
sudo apt install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt install -y postgresql-18
```

PostgreSQL listens on localhost only by default; keep it that way (port 5432
stays closed in `ufw`).

A system user for the app, and its folders:

```bash
sudo adduser --system --group --home /opt/asms asms
sudo mkdir -p /var/lib/asms/uploads/documents /var/backups/asms /var/www/asms
sudo chown -R asms:asms /var/lib/asms /var/backups/asms
```

## 2. Database

```bash
sudo -u postgres psql -c "CREATE ROLE asms_user LOGIN PASSWORD '<long random password>';"
sudo -u postgres createdb -O asms_user asms
```

**Moving the school's data from the Windows PC** (instead of starting empty):

1. On Windows, stop the backend, then make a fresh dump:
   `"C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -U postgres -Fc -f C:\asms\asms_move.dump asms`
2. Copy `asms_move.dump` and the folder `C:\asms\asms-backend\uploads\documents`
   to the server (for example with `scp`). Leave out `uploads\_to_delete`.
3. On the server:

```bash
sudo -u postgres pg_restore --no-owner --role=asms_user -d asms /tmp/asms_move.dump
sudo rsync -a /tmp/documents/ /var/lib/asms/uploads/documents/
sudo chown -R asms:asms /var/lib/asms/uploads
```

4. Run the migrations (§4) so the server is at the latest version, then compare a
   few numbers with the PC (students, payments total, documents).

## 3. Code and settings

```bash
sudo -u asms git clone https://github.com/<owner>/asms-backend.git /opt/asms/asms-backend
cd /opt/asms/asms-backend && sudo -u asms npm ci --omit=dev
```

`/opt/asms/asms-backend/.env` (owner `asms`, mode `600`):

| Variable | Production value |
|---|---|
| `PORT` | `3000` (nginx is the only client) |
| `NODE_ENV` | `production`: the refresh cookie is `Secure` (HTTPS only) |
| `CORS_ORIGINS` | empty: the app and the API share one origin |
| `TRUST_PROXY` | `loopback`: `req.ip` is the client's (login rate limit, audit log), taken from nginx's `X-Forwarded-For` |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | `localhost`, `5432`, `asms`, `asms_user`, the password from §2 |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | **new** values, not the development ones: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` (twice). Changing them later logs everyone out |
| `JWT_REFRESH_EXPIRES_IN` | `7d` |
| `SCHOOL_NAME`, `SCHOOL_NAME_AM`, `SCHOOL_CODE` | as on the PC |
| `UPLOAD_DIR` | `/var/lib/asms/uploads/documents` (outside the code folder, so a new checkout never touches it) |

```bash
sudo chmod 600 /opt/asms/asms-backend/.env && sudo chown asms:asms /opt/asms/asms-backend/.env
```

**The app.** Build it on the server (or on the PC and copy `dist/`):

```bash
sudo -u asms git clone https://github.com/<owner>/asms-web.git /opt/asms/asms-web
cd /opt/asms/asms-web && sudo -u asms npm ci && sudo -u asms npm run build
sudo rsync -a --delete /opt/asms/asms-web/dist/ /var/www/asms/
```

`VITE_API_BASE` stays at its default `/api`. Production builds have no source
maps.

## 4. Migrations

Always with a backup first (§7):

```bash
sudo /usr/local/bin/asms-backup          # §7
cd /opt/asms/asms-backend && sudo -u asms npm run migrate
```

Migrations stop on their own when the data is not as expected (for example 026
checks every old payment before dropping its columns). Rollback is restoring
the backup.

## 5. The API as a service (systemd)

`/etc/systemd/system/asms-backend.service`:

```ini
[Unit]
Description=ASMS backend
After=network.target postgresql.service
Requires=postgresql.service

[Service]
User=asms
WorkingDirectory=/opt/asms/asms-backend
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=/var/lib/asms

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now asms-backend
curl -s http://127.0.0.1:3000/health                # {"status":"OK",...}
journalctl -u asms-backend -f                       # logs
```

(pm2 works too, but systemd is already there and restarts the API after a
reboot or a crash; logs go to the journal.)

## 6. nginx and HTTPS

`/etc/nginx/sites-available/asms`:

```nginx
server {
    listen 80;
    server_name school.example.et;

    root /var/www/asms;
    index index.html;

    # Uploads are up to 10 MB (multer); leave room for the form fields
    client_max_body_size 12m;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;          # large PDFs and reports
    }

    # For an uptime check (the API's health route is not under /api)
    location = /health {
        proxy_pass http://127.0.0.1:3000;
    }

    # Built files have hashed names: cache them for a year
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # Client routes (/students/123, /finance/...) fall back to the app
    location / {
        add_header Cache-Control "no-cache";
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/asms /etc/nginx/sites-enabled/asms
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

**HTTPS (Let's Encrypt):**

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d school.example.et --redirect   # adds the 443 server and the 80 → 443 redirect
sudo certbot renew --dry-run                           # renewal runs on its own (systemd timer)
```

Then open `https://school.example.et`, log in, and check: a page reload on a
deep link (for example `/students`), a document upload of a few MB, a PDF.

## 7. Backups

**What:** the database (`pg_dump -Fc`) and the uploads folder. **When:** every
night. **Kept:** 14 days on the server, and a copy off the server (a VPS can be
lost with its backups).

`/usr/local/bin/asms-backup` (mode `755`):

```bash
#!/usr/bin/env bash
# Nightly ASMS backup: database dump + uploads, 14 days kept
set -euo pipefail
DIR=/var/backups/asms; STAMP=$(date +%Y-%m-%dT%H-%M)
sudo -u postgres pg_dump -Fc asms > "$DIR/asms_$STAMP.dump"
tar -czf "$DIR/uploads_$STAMP.tar.gz" -C /var/lib/asms uploads
find "$DIR" -name 'asms_*.dump' -mtime +14 -delete
find "$DIR" -name 'uploads_*.tar.gz' -mtime +14 -delete
```

`/etc/cron.d/asms-backup`:

```
30 1 * * * root /usr/local/bin/asms-backup >> /var/log/asms-backup.log 2>&1
```

**Off the server:** copy `/var/backups/asms` every night to another place, for
example the school PC (`scp`/`rsync` over SSH with a key) or object storage
(`rclone`). At least once a week.

**Restore test (once a month, and after any change to the backup):** restore the
latest dump into a scratch database and compare counts:

```bash
sudo -u postgres createdb -O asms_user asms_restore_check
sudo -u postgres pg_restore --no-owner --role=asms_user -d asms_restore_check /var/backups/asms/asms_<latest>.dump
sudo -u postgres psql -d asms_restore_check -c "SELECT (SELECT COUNT(*) FROM students) students, (SELECT COUNT(*) FROM payments) payments, (SELECT COUNT(*) FROM documents) documents;"
sudo -u postgres dropdb asms_restore_check
```

and list one uploads archive (`tar -tzf … | head`).

**Restoring for real:** stop the API (`systemctl stop asms-backend`), restore the
dump into a new database, point `DB_NAME` at it (or drop and re-create `asms`
and restore into it), unpack the uploads, start the API.

**The old `.dump` files in `C:\asms`** (`asms_backup_before_0NN_*.dump`, from the
migration rehearsals): move them into one folder, for example
`C:\asms\backups\`, and keep at least the last one before each migration
until the server has run for a few months. They contain everything the school
had at that time, including the two dropped grade letters (026).

## 8. Updates

```bash
sudo /usr/local/bin/asms-backup
cd /opt/asms/asms-backend && sudo -u asms git pull && sudo -u asms npm ci --omit=dev && sudo -u asms npm run migrate
sudo systemctl restart asms-backend
cd /opt/asms/asms-web && sudo -u asms git pull && sudo -u asms npm ci && sudo -u asms npm run build
sudo rsync -a --delete /opt/asms/asms-web/dist/ /var/www/asms/
```

Deploy the backend first when a release needs both (the app may use new API
fields).

## 9. Logs and monitoring

- API: `journalctl -u asms-backend` (errors, startup). The audit log in the app
  records who changed what.
- nginx: `/var/log/nginx/access.log`, `error.log` (rotated by logrotate).
- Backups: `/var/log/asms-backup.log`; check the newest file's date now and then.
- Disk: `df -h` (dumps and uploads grow); `unattended-upgrades` for security
  updates (`sudo dpkg-reconfigure unattended-upgrades`).
- Optional: an external uptime check on `https://school.example.et/health`
  (answers `{"status":"OK",...}` while the API and nginx are up).

## 10. Checklist

- [ ] DNS points at the server; `ufw` allows 22, 80, 443 only
- [ ] Timezone Africa/Addis_Ababa
- [ ] PostgreSQL 18, `asms` restored, migrations run
- [ ] `.env`: `NODE_ENV=production`, `TRUST_PROXY=loopback`, `CORS_ORIGINS` empty, new JWT secrets, `UPLOAD_DIR=/var/lib/asms/uploads/documents`
- [ ] Uploads copied (not `_to_delete`), owned by `asms`
- [ ] `asms-backend` service enabled; `/health` answers
- [ ] App built and in `/var/www/asms`; deep links reload; 10 MB upload works
- [ ] HTTPS with redirect; `certbot renew --dry-run` passes
- [ ] Nightly backup runs; off-server copy; first restore test done
- [ ] The old frontend is not deployed (retired in M10)
