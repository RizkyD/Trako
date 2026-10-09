# Remix App Agent Guide

This app was scaffolded with `remix new`. Use these conventions when continuing to build it out.

## Commands

```sh
npm i
npm run dev
npm run hmr
npm run start
npm test
npm run typecheck
```

Use `npm run hmr` for live server and browser updates; `npm run dev` only watches and restarts the server. `npm run start` runs in production mode without a separate build step.

## Building Features

Refer to ./.agents/skills/remix/SKILL.md for the Remix mental model and how to find guides and API READMEs through `node_modules/remix/INDEX.md`.

## Starter Layout

- `app/routes.ts` defines the shared route contract used by server and browser modules for type-safe hrefs
- `app/router.ts` wires routes to controllers and installs the standard Remix component renderer used by actions
- Put top-level route actions in `app/actions/controller.tsx`; add `app/actions/<route-key>/controller.tsx` for nested route maps. `app/actions/controller.test.ts` is the root controller's router smoke test
- `app/actions/pages.tsx` and `app/actions/document.tsx` render the Trako UI (sign in, titles, edit, franchises, stats); UI text is English
- `app/db.ts` owns the SQLite schema (`node:sqlite`, file `data/tracker.db`), its migrations, password hashing, and item/franchise queries
- Settings page (`/settings`): theme picker (`app/actions/public/theme-toggle.tsx` + `public/theme.js`), export, import, and imports from MyAnimeList, CSV files and Steam
- `app/transfer.ts` exports and imports the whole list as one JSON file (covers embedded); `importItems` loads titles from other services through the same checks
- `app/importers.ts` turns MyAnimeList exports, CSV files and Steam libraries into titles for `importItems`
- `app/lookup.ts` looks titles up on Wikipedia and AniList for the add and edit forms' "Fetch details" button (`app/actions/public/title-lookup.tsx`, route `/lookup`)
- `app/covers.ts` stores uploaded cover images in `data/covers/` and serves them through the `covers` route; it also downloads picked covers, only from an allowlist of image hosts
- `app/actions/public/` contains the browser runtime entry
- `app/assets.ts` owns the server-side asset pipeline used by the asset route and render middleware
- Root `public/` contains static files served unchanged from the app root

This starter intentionally begins small; add directories like `app/data/`, `app/middleware/`, `app/ui/`, and `test/` only when you need them.
