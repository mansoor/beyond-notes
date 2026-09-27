# Installing Beyond Notes

Every option runs the same public image, `ghcr.io/mansoor/beyond-notes`
(amd64 and arm64). Whichever you pick, two things matter:

- **Keep `/app/data` on a volume or a folder you back up.** The SQLite
  database, uploads, backups and the secrets key live there (with Postgres, all
  but the database do).
- **Set `BASE_URL`** to the address you actually open, e.g.
  `https://notes.example.com`. Links, single sign-on and passkeys depend on it.

| Platform | Use |
| --- | --- |
| Plain Docker | the `docker run` line in the [main README](../README.md#a-docker-run-sqlite--simplest) |
| Docker Compose | [`compose/sqlite.yml`](compose/sqlite.yml) or [`compose/postgres.yml`](compose/postgres.yml) |
| Portainer | Stacks → Add stack → paste a compose file above |
| Dockge | + Compose → paste a compose file above |
| Coolify | New resource → Docker Compose → paste a compose file above |
| Unraid | [`unraid/beyond-notes.xml`](unraid/beyond-notes.xml) (see below) |
| CasaOS / ZimaOS | [`casaos/docker-compose.yml`](casaos/docker-compose.yml): App Store → Custom Install → Import |

## Unraid

Until it's in Community Applications, add the template by URL:

1. **Docker → Add Container → Template repositories**, add
   `https://github.com/mansoor/beyond-notes` and save; or
2. copy [`beyond-notes.xml`](unraid/beyond-notes.xml) to
   `/boot/config/plugins/dockerMan/templates-user/` on the flash drive.

Then **Add Container**, pick *beyond-notes*, set **Base URL**, and apply.
Data goes to `/mnt/user/appdata/beyond-notes`.

## After it starts

Open the address and create the admin account; the first account becomes the
admin. Then:

- put it behind HTTPS (see [Putting it on the internet](../README.md#putting-it-on-the-internet));
- turn on scheduled backups (Settings → Backup);
- optionally connect single sign-on (Settings → Security) or your reverse
  proxy's sign-in (the `AUTH_PROXY_*` variables in
  [`.env.example`](../.env.example)).

Upgrading is `docker compose pull && docker compose up -d` (or "Update" in your
platform). A SQLite database is copied to the backups folder automatically
before any database migration runs.
