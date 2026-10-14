# Trako

A personal tracker for games, manga, novels, films, series and anime: what is planned, in
progress and finished, with ratings, notes, covers, franchises and stats. It has one account
and keeps everything in a SQLite file on your own machine. Built with Remix 3.

## Requirements

- Node.js 24.3 or newer.
- On Windows, Git for Windows: the npm scripts run through Git Bash (see `.npmrc`).

## Running

```sh
npm i
npm run dev    # development, restarts on changes: http://localhost:44100
npm start      # production mode
```

The first visit asks you to create the account.

## Your data

Everything lives in `data/`: the database `tracker.db` and the cover images in `covers/`.
`DB_PATH` puts the database elsewhere; the covers then go next to it.

Settings → Export downloads the whole list as one JSON file (covers included), and Import
loads such a file back.

## Backups

Settings → Backups takes a folder (its full path) and how many backups to keep (14 by
default). While the server runs it writes `trako-YYYY-MM-DD.json`, the same file as Export,
into that folder once a day: shortly after it starts, then checking every hour. It deletes the
oldest backups beyond the number kept, and touches no other files there. Back up now writes
today's file at once. A failed automatic backup is only written to the server's log, so check
the "Last backup" line now and then.

To restore, use Settings → Import with Replace everything.

## Signing in

- After 10 failed sign-ins within 15 minutes, from one address or for one username, sign-in
  is refused for the rest of those 15 minutes, even with the right password. Restarting the
  server clears this.
- Changing the password signs out every other browser and device. Settings → Sessions →
  Sign out everywhere signs out all of them, including the one you are using.

### Forgotten password

```sh
npm run reset-password -- <username>
```

It asks for the new password twice (at least 8 characters), signs out every session, and
works on `DB_PATH` when that is set. The server may keep running meanwhile.

## Running in the background on Windows

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1               # port 44100
powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1 -Port 8080
powershell -ExecutionPolicy Bypass -File scripts\uninstall-service.ps1
```

The install script registers a scheduled task named Trako. The task starts the server in
production mode, in a hidden window, every time you sign in to Windows, and the script also
starts it right away. The server's output goes to `logs\trako.log`. `npm start` cannot be used
for this, because the npm scripts need Git Bash; the task runs `scripts\service.cmd` with the
node executable that was current at install time.

Run the install script again to restart the server, for example after updating Trako or
Node.js, to change the port, or after moving the folder. Add `-WhatIf` to either script to
see what it would do without doing it. The uninstall script stops the server and removes the
task; `data\` is left as it is.

## Phone and other devices at home

The server listens on every network interface, so a phone on the same Wi-Fi can open
`http://<this PC's address>:44100` (`ipconfig` shows the address). The first time Node.js
starts listening, Windows Firewall asks whether to allow it: allow private networks only. If
that prompt was dismissed, allow `node.exe` under Windows Security → Firewall & network
protection → Allow an app through firewall. This is plain HTTP, so use it only on a network
you trust.

## HTTPS and access from the internet

Trako itself speaks plain HTTP. For HTTPS, put a reverse proxy in front of it. With
[Caddy](https://caddyserver.com), which gets the certificate by itself, copy
`Caddyfile.example` to `Caddyfile` and put in your domain:

```
trako.example.com {
	reverse_proxy localhost:44100
}
```

nginx works too: `proxy_pass http://127.0.0.1:44100;` with `proxy_set_header` lines for
`Host $host`, `X-Forwarded-Proto $scheme` and `X-Forwarded-For $proxy_add_x_forwarded_for`.

Then start Trako with `TRUST_PROXY=1`, so it believes the proxy's `X-Forwarded-*` headers. It
then sees the browser's `https://` address, which gives the session cookie its `Secure` flag,
and the sign-in limit counts each visitor's address instead of the proxy's. With the proxy on
the same PC, also set `HOST=127.0.0.1`, so that nothing reaches Trako except through the
proxy: anything that reaches it directly could fake those headers. The Windows task does both
with `scripts\install-service.ps1 -BehindProxy`.

Trako has a single account and no rate limits beyond sign-in. Putting it on the public
internet is at your own risk; a VPN into your home network is the safer way to reach it from
outside.

## Environment variables

| Variable      | Default           | Meaning                                                           |
| ------------- | ----------------- | ----------------------------------------------------------------- |
| `PORT`        | `44100`           | Port to listen on.                                                |
| `HOST`        | every interface   | Address to listen on, e.g. `127.0.0.1` behind a proxy on this PC. |
| `DB_PATH`     | `data/tracker.db` | The database file; covers are stored next to it.                  |
| `TRUST_PROXY` | off               | `1` behind a reverse proxy: trust its `X-Forwarded-*` headers.    |

The npm scripts set `NODE_ENV` themselves. In Git Bash, set a variable for one run with
`PORT=8080 npm start`; in PowerShell, `$env:PORT = 8080` before `npm start` sets it for the
rest of that window.

## Development

```sh
npm test            # tests, on an in-memory database
npm run typecheck
npm run hmr         # like dev, with live updates in the browser
```

Tests sit next to the code they cover. `npm test` runs the `*.test.ts` files, which send
requests through the router (helpers in `app/test-helpers.ts`); the `*.test.browser.tsx` files
test the client components in a browser with `npm run test:browser`, which needs Playwright
first (`npm i -D playwright`).

`AGENTS.md` describes how the code is laid out.
