# JBB (Junior Ballers 254) — Tournament Manager
## Deployment Guide — Clean Start (Local Dev + VPS)

This is a from-scratch deployment: fresh `pb_data`, no history carried over
from Manager. Covers both your local machine and the VPS.

Runs alongside your existing Manager deployment on the same VPS, in its own
folder and its own Docker container.

```
/home/tournaments/
├── Manager/     ← existing deployment
└── JBB/         ← this project
```

---

## Part A — Local machine

### A1. Project folder

Unzip the provided `jbb-clean.zip` (or arrange the files yourself) so you have:

```
~/tournaments/JBB/
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── pocketbase              ← Linux amd64 binary, works for both Fedora dev and the Ubuntu VPS
├── pb_migrations/          ← schema, 30+ migrations, same as Manager
└── pb_public/              ← JB254 warm-community themed frontend
    ├── index.html, teams.html, stats.html, bracket.html, login.html
    └── assets/
        ├── css/styles.css
        ├── js/ (app.js, db.js, bracket.js, auth.js, etc. + pocketbase.umd.js SDK)
        └── icons.svg
```

There is intentionally no `pb_data/` yet — PocketBase creates it on first run.

### A2. Test it locally before touching the VPS

```bash
cd ~/tournaments/JBB
chmod +x pocketbase
docker compose up --build
```

Visit `http://127.0.0.1:8091` (or whatever port your `docker-compose.yml`
maps) and confirm the app loads with the new JB254 theme.

Create the superuser once, in a second terminal:

```bash
docker compose exec jbb-tournaments ./pocketbase superuser upsert admin@yourdomain.com 'a-strong-password'
```

Log in to the admin UI (`http://127.0.0.1:8091/_/`) and spot-check that the
`tournaments`, `teams`, `fixtures`, `master_teams`, `team_stats`, `users`,
and `favourites` collections exist and are empty.

Stop it once satisfied:

```bash
docker compose down       # keeps the pb_data volume
```

### A3. Set up the sync tool

Save the `JBB` script to `~/.local/bin/JBB`, edit `SOURCE_DIR` to point at
`~/tournaments/JBB/` (or wherever you placed it), then:

```bash
chmod +x ~/.local/bin/JBB
```

---

## Part B — VPS

### B1. Confirm the target folder is empty

```bash
vps
ls -la /home/tournaments/JBB
exit
```

Should be empty (you've already cleaned it out).

### B2. First sync

From your local machine:

```bash
JBB
```

Pick option 1 (Standard Sync). This pushes `pocketbase`, `pb_migrations/`,
`pb_public/`, and the Docker files to `/home/tournaments/JBB/` on the VPS.
`pb_data/`, `.git`, `.env`, and local junk are excluded automatically.

### B3. Build and run

```bash
vps
cd /home/tournaments/JBB
docker compose up -d --build
```

This creates a fresh `jbb_pb_data` volume, starts the container, and
PocketBase applies all of `pb_migrations/` automatically — same schema as
Manager, empty tables.

### B4. Create the superuser (VPS)

```bash
docker compose exec jbb-tournaments ./pocketbase superuser upsert admin@yourdomain.com 'a-strong-password'
```

Use a different password than Manager's, even though they're separate apps.

### B5. Verify

```bash
curl http://127.0.0.1:8091/api/health
docker compose logs --tail=50 jbb-tournaments
```

Health check should return `{"code":200,...}`. Logs should show migrations
applying cleanly with no errors.

At this point JBB is running on the VPS at `127.0.0.1:8091`, not yet
reachable from outside — that's the Nginx step, deliberately deferred.

---

## Every deploy after this (steady state)

```bash
JBB                                              # locally: sync changes
vps                                              # connect
cd /home/tournaments/JBB && docker compose up -d --build
```

---

## Backup (once there's real data worth backing up)

```bash
docker run --rm \
  -v jbb_pb_data:/data \
  -v /home/$USER/backups:/backup \
  alpine sh -c "cp /data/data.db /backup/jbb-data-$(date +%Y%m%d).db"
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `docker compose up` fails immediately | Check `./pocketbase` has execute permission: `chmod +x pocketbase` |
| Migrations don't apply / empty collections list | `docker compose logs jbb-tournaments` — look for migration errors on first boot |
| Port already in use | Something (Manager?) already holds it — check `docker ps`, adjust the port in `docker-compose.yml` |
| App loads but looks unthemed | Confirm you copied `pb_public/` from the JB254 theme bundle, not Manager's original |
| Blank page, console errors about PocketBase not defined | `pb_public/assets/js/pocketbase.umd.js` is missing — it was intentionally excluded from the theme-only zip; it's included in `jbb-clean.zip` |

---

## Coming next (Part 2, not yet done)

Nginx reverse proxy to expose JBB publicly on its own domain/subdomain,
alongside Manager's existing Nginx config on the same VPS.
