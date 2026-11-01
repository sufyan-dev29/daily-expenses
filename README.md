# Expense tracker

Private, installable (PWA) expense and income tracker. Next.js + Supabase + Vercel, all on free tiers.
Add an entry in about three taps, see graphs by day, week, month and year, and optionally mirror everything to a Google Sheet.

**Deploy it:** follow [SETUP.md](SETUP.md).
**Full spec and design system:** [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md).

## What is in here

| Area | Where |
|---|---|
| Add expense / income (sentence form, templates, swipe to Trash, pull down for History, success animation) | `components/entry/` |
| Insights (filters, charts, table, CSV) | `components/insights/`, SQL function `insights()` |
| Settings (lists with icons and colours, templates, palettes, formats, Google Sheet, SMTP, account) | `components/settings/` |
| Palettes (a seed colour plus a Material 3 style → light + dark; applied live over AJAX) | `lib/palette.ts` (browser-safe helpers), `lib/theme.ts` (server only), `app/api/theme/*`, `components/settings/PalettePicker.tsx` |
| Navigation, sheets, gestures, shared UI | `components/AppShell.tsx`, `components/ui/` |
| App icon (generated, no image files) | `app/icons/[size]/route.tsx` |
| Auth, setup wizard, cron, sheet sync, mailer | `app/api/*`, `lib/sheets.ts`, `lib/mailer.ts` |
| Database schema + row-level security | `supabase/migrations/001_init.sql` |
| Offline queue (IndexedDB) | `lib/offline.ts` |

## Develop

```bash
cp .env.example .env.local   # fill in
npm install
npm run dev                  # http://localhost:3000  (open /setup first)
npm run typecheck
npm run test:rls
```

**Windows:** if PowerShell says "running scripts is disabled" when you run `npm`, run `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` once, or use `npm.cmd` instead of `npm`.

**Fonts:** the app uses the device's system font (San Francisco on Apple devices) and falls back to self-hosted Inter, so nothing is downloaded from a font CDN.

## Security model in one paragraph

Every page and API requires a session, except login, forgot, reset, the one-time `/setup` (token-protected, locks itself once an owner exists) and the cron routes (bearer secret). Every table has row-level security scoped to `auth.uid()`; `secrets` and `sync_outbox` have no policies at all, so only the server (service role) can touch them. SMTP and Google keys are encrypted with AES-256-GCM before storage and never sent to the browser. Public sign-up is off.

## Known limits

- Two-factor login (TOTP) is not built yet.
- The rate limiter is in-memory (per serverless instance), so it slows guessing but is not a hard guarantee.
- Offline: entries made without signal queue on the device and sync when back online; the app shell itself is not available offline on a cold start.
