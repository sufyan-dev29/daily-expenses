# Expense Tracker PWA — Complete Spec, Design System & LLM Handoff

> **Purpose of this file:** the single, self-contained brief for the whole project. Any LLM (or developer) can read this in a fresh session and continue without the original chat.
>
> - **Part A** (sections 0–18): product spec, architecture, data model, security, setup, roadmap, instructions to the next LLM. **Read sections 0 and 17 first.**
> - **Part B** (sections D1–D14): the binding design system. Read it before building any UI.
>
> Last updated: 2026-10-04 (late) · Status: **full app coded and DEPLOYED on Vercel (site loads). Owner is mid-way through the first-run `/setup` wizard: token accepted, database step being fixed (Session pooler `DATABASE_URL`). Migrations, owner account, sign-in and real-UI testing are still to do. See section 19 (deployment state and runbook) for exactly where to resume.** Mockup approval was skipped at the owner's request; the owner reviews the running app instead. Design is a proposed baseline; once the owner approves the real UI, it wins over any conflicting detail in Part B.

## Contents

**Part A — Product & engineering spec**
0 TL;DR · 1 Goals · 2 Locked decisions · 3 Owner's existing data · 4 Architecture · 5 Data model · 6 Authentication · 7 Screens & behaviour · 8 Analytics · 9 Google Sheet sync · 10 Security · 11 Keep-alive & cron · 12 Cloneability & setup · 13 Design summary · 14 Offline & PWA · 15 Roadmap & status · 16 Open items · 17 Instructions to any LLM · 18 Decision log · **19 Deployment state & runbook (start here to resume)**

**Part B — Design system**
D1 Intent · D2 Colour · D3 Typography · D4 Shape & spacing · D5 Layout & navigation · D6 Components · D7 Motion · D8 Insights styling · D9 Auth/setup/settings screens · D10 Iconography · D11 Accessibility · D12 Implementation notes · D13 Review checklist · D14 Change log

---

# PART A — PRODUCT & ENGINEERING SPEC

## 0. TL;DR for the next LLM

- **What:** a mobile-first, installable web app (PWA) for logging expenses and income in seconds, with rich analytics, backed by **Supabase**, hosted on **Vercel (free tiers)**, with an optional one-way sync to a **Google Sheet**.
- **Why:** the owner procrastinates updating a Google Sheet by hand. Entry must take only a few taps.
- **Owner:** Sufyan (CTO of a web agency, technical: WordPress, Docker, n8n, Make). Based in Pakistan. Currency **PKR only** by default.
- **Must be cloneable:** other people should be able to deploy their own private copy using a Deploy button, a locked first-run setup screen and a `SETUP.md`.
- **Rules of engagement:** do not assume. Ask the owner when something in section 16 (Open items) matters. Nothing configurable may be hardcoded. Nothing may be public: everything except the login/reset pages sits behind authentication.
- **Next action:** read section 19, then resume the first-run wizard on the live site (check connection, run migrations, create the owner account), then have the owner exercise the real UI and fix what they find. Section 15 is the roadmap.

---

## 1. Product goals

1. Add an expense in about 3 taps (name, amount, confirm) because smart defaults fill the rest.
2. Track **income** as well as expenses.
3. Show **graphs and data by day, week, month and year**, with filters (section 8). Must be excellent on **phone and desktop**.
4. Everything the owner might change later is editable in-app (lists, SMTP, Google Sheet link, theme, etc.).
5. Private by default. Free to host.
6. Cloneable for other users.

Non-goals (not requested; do not build unless the owner asks): budgets/limits, multi-currency, receipt scanning, bank import, shared/family ledgers.

---

## 2. Locked decisions

| Area | Decision |
|---|---|
| Backend | **Supabase** (Postgres + Auth), free tier |
| Hosting | **Vercel** Hobby (free). The owner's VPS is **not** involved |
| Framework | Next.js (App Router, TypeScript), Tailwind CSS |
| Design | Material You / Google Pixel style, "Direction A" (see section 13). Light + dark |
| Auth | Email **or** username + password. **Forgot password** via SMTP. Public sign-up disabled |
| Google Sheet | One-way sync Supabase -> Sheet using a **Google Cloud service account** (Sheets API). Optional step in setup |
| Keep-alive | **Vercel Cron** (daily) calling a protected health route; **n8n** (owner has it) as an optional backup caller |
| New sheet | The owner wants a **new** Google Sheet for the app, reusing the old fields |
| Cloneability | Deploy-to-Vercel button, setup wizard that locks itself, `SETUP.md` with step-by-step guides |
| Currency | PKR (configurable in settings; no multi-currency logic) |
| Old sheet tabs | Setup / Tracker / Calc / Analysis tabs of the old sheet are **ignored** |

---

## 3. Owner's existing data model (reference only)

The old sheet's first month tab has these columns, in this order:

`Date | Description | Category | Amount | Payment Mode | Bank Name | Type | Notes`

- Date looked like `Thu, 10 Sep 2026`.
- **Type** means **Need / Want** (manual, not derived from category).
- **Bank Name** is the account used to pay. **Payment Mode** is how (Bank Transfer, Credit Card, Cash, Mobile Payment). The two are **independent** (never auto-paired).
- Many rows are fixed monthly items (bills, allowances, groceries), which is why **templates** matter.

Example values seen (use only as optional *seed/import suggestions*, never hardcode):
- Categories: Education, Utilities, Groceries, Housing, Personal Expense, Healthcare, Transportation, Personal Help
- Payment modes: Bank Transfer, Credit Card, Cash, Mobile Payment
- Banks/wallets: MCB Bank, JS Bank, Jazzcash, Opay, United Bank Limited, Digitt+, a Bank Islami account, Nayapay

---

## 4. Architecture

```
Phone / Desktop (PWA)  --HTTPS-->  Vercel (Next.js: UI + server routes)
                                      |-- Supabase (Postgres + Auth, RLS)
                                      |-- Google Sheets API (service account, outbound only)
                                      |-- SMTP (via Auth email hook / app mailer)
Vercel Cron (daily) + n8n (optional) --> /api/cron/* (protected by CRON_SECRET)
```

Suggested libraries (swap if there is a good reason, then record it in section 18):
- `@supabase/supabase-js`, `@supabase/ssr` (cookie sessions)
- `zod` (validation), `pg` (setup migrations), `nodemailer` (SMTP), `googleapis` (Sheets)
- `framer-motion` (animation), `recharts` (charts), `date-fns` / `date-fns-tz` (dates)
- PWA: web manifest + service worker (e.g. Serwist), `idb` for the offline queue
- UI: Tailwind + Radix primitives or hand-built M3-style components

Suggested repo layout:

```
/app            routes: (auth) login, forgot, reset · (app) expense, income, insights, settings, trash · setup · api
/components     ui, forms, charts, nav
/lib            supabase clients, auth guards, crypto, sheets, mailer, analytics, theme
/supabase       migrations/*.sql, seed
/docs           SETUP.md, guides, architecture
vercel.json     cron config
```

---

## 5. Data model (reference draft, finalize in migrations)

All tables have `user_id uuid references auth.users` and **RLS enabled** with policies restricting rows to `auth.uid() = user_id`. Index `user_id` and the columns used in filters (RLS performance).

```sql
-- profile & settings
profiles(id uuid pk references auth.users, username text unique, display_name text, created_at timestamptz)
user_settings(user_id uuid pk, theme_mode text default 'system', accent_hex text, currency text default 'PKR',
              locale text, date_format text, week_start smallint default 1, timezone text default 'Asia/Karachi',
              remember_last jsonb, trash_retention_days int default 30, sheet jsonb, updated_at timestamptz)
secrets(user_id uuid, key text, ciphertext bytea, iv bytea, primary key (user_id, key))  -- SMTP password, Google key (encrypted app-side)

-- user-managed lists: nothing hardcoded
options(id uuid pk, user_id uuid, kind text check (kind in ('bank','payment_mode','category','income_source')),
        name text not null, sort_order int, color text, icon text, archived_at timestamptz, created_at timestamptz,
        unique (user_id, kind, name))

transactions(id uuid pk, user_id uuid,
        kind text check (kind in ('expense','income')),
        name text not null, amount numeric(14,2) check (amount > 0),
        occurred_on date not null,                       -- DATE, not timestamp (avoids timezone bugs)
        category_id uuid, bank_id uuid, payment_mode_id uuid, income_source_id uuid,
        need_want text check (need_want in ('need','want')),   -- expenses only
        notes text, deleted_at timestamptz,               -- soft delete = Trash
        sheet_synced_at timestamptz, created_at timestamptz, updated_at timestamptz)

templates(id uuid pk, user_id uuid, kind text, name text, behavior text check (behavior in ('fill','instant')),
        payload jsonb,  -- name/amount?/category_id/bank_id/payment_mode_id/need_want/notes, all optional
        sort_order int, created_at timestamptz)

sync_outbox(id bigserial pk, user_id uuid, transaction_id uuid, op text check (op in ('upsert','delete')),
        attempts int default 0, last_error text, next_attempt_at timestamptz, created_at timestamptz)
```

Rules:
- Options referenced by transactions are **archived**, never hard-deleted (old entries keep their names).
- Changes to `transactions` enqueue a `sync_outbox` row (DB trigger or server action).
- A scheduled job purges `deleted_at` older than the retention setting.
- Analytics must read via SQL views/RPC functions marked `security_invoker` so RLS still applies.

---

## 6. Authentication

- Supabase Auth, **email + password**. Login field accepts **email or username**: the server looks up the email for a username and returns a **generic error** on failure (no account enumeration).
- Public sign-up **disabled**. The owner account is created by the setup wizard using the service role admin API.
- **Forgot password / reset** is required. Supabase's built-in email sender is heavily rate-limited (verify current limits), so custom SMTP is required.
- To make SMTP **editable inside the app**, route Supabase Auth emails through the **Send Email Hook** to `/api/auth/send-email`, which sends via the SMTP stored in settings (verify the hook signature per Supabase docs). **Fallback:** SMTP configured in the Supabase dashboard. Keep password login as the primary path so a broken SMTP config never locks the owner out.
- Optional TOTP two-factor login in Settings > Security.
- Middleware + server-side checks: every route except `/login`, `/forgot`, `/reset`, `/setup` (while unlocked), and `/api/cron/*` (secret-protected) requires a valid session.

---

## 7. Core screens & behaviour

### 7.1 Navigation
- **Mobile:** bottom navigation, **icons**, label shown under the selected item (Material 3 pattern). Tabs: Expense, Income, Insights, Settings.
- **Desktop (>= ~900px):** navigation rail or side drawer, **two-pane** layouts (form on the left, history on the right), wider dashboards, keyboard support, hover tooltips on charts. Desktop must be a first-class experience, not a stretched phone view.

### 7.2 Add Expense (the most important screen)
- iOS-Shortcuts-style **sentence form**: "I spent **Rs [amount]** on **[name]**, paid from **[bank]** via **[payment mode]**, on **[today]**". Each bold token is tappable; bank/mode/date open bottom sheets (dialogs on desktop). The amount uses a big numeric pad.
- Below: **Category**, **Need/Want** segmented toggle, **Notes**.
- **Defaults:** category, bank, payment mode and Need/Want pre-fill from the **most recent entry** (per kind: expense and income remember separately). Date = today. Name, amount and notes start empty. If the remembered option is archived, leave that field empty. Editing an old entry never changes the remembered defaults. Per-field "remember last used" toggles in Settings.
- **CTA text is contextual:** `Add Expense` / `Add Income` / `Update Expense` / `Update Income`.
- **Success animation** (Google Wallet-like): the button expands into a circle, a check mark draws itself, a short haptic (`navigator.vibrate` where supported), then the form resets. Respect `prefers-reduced-motion`.
- **Templates strip** above the form (chips). Each template is `fill` (tap to prefill, review, add) or `instant` (one tap adds). "Save as template" from any entry. Manage/reorder in Settings. Optional **Monthly bundle** idea: add a group of recurring templates at once with an editable checklist (propose to the owner; not confirmed).
- **History:** pull down from the top of the page reveals all entries on screens under 1024px (a deliberate JS gesture in `EntryScreen`, never a browser refresh; `overscroll-behavior: none` on html and body disables Chrome's pull-to-refresh). A History button in the header does the same, and swiping the panel down closes it. From 1024px the history is a permanent side card. **Swipe** an entry to move it to **Trash** (with an Undo snackbar). **Tap** an entry to edit it in the same form (CTA becomes `Update ...`). On desktop the history is a persistent side panel with row actions.
- Trash screen: restore or delete forever; auto-purge after the retention period.

### 7.3 Add Income
Same pattern: source, amount, deposited-to bank, mode (if applicable), date, notes. No Need/Want. History, swipe and templates behave the same.

### 7.4 Insights — see section 8.

### 7.5 Settings (everything editable)
- **Lists:** banks, payment modes, categories, income sources (add, rename, reorder, archive).
- **Templates:** create, edit, reorder, delete.
- **Appearance:** theme mode (System / Light / Dark; saved to the account and to local storage to avoid a flash), accent/seed colour.
- **Google Sheet:** paste link, tab name, test connection, "full resync", last sync status and errors.
- **Email (SMTP):** host, port, security, username, password, from-address, "send test email".
- **Formats:** currency (PKR default), date format, week start day, timezone.
- **Behaviour:** remember-last toggles, trash retention days.
- **Data & account:** CSV export, change password, two-factor, sign out of other sessions.

---

## 8. Analytics (high priority)

The owner explicitly wants **data and graphs by week, month and year, with filters**, usable on phone and desktop.

**Granularity:** day, week, month, year (week start configurable, default Monday; define week numbering explicitly and keep it consistent).
**Range presets:** this week, last week, this month, last month, last 3/6/12 months, this year, last year, custom range, all time.
**Compare:** vs previous period (week-over-week, month-over-month, year-over-year) with delta and percent.
**Filters (combinable, shareable via URL query params):** entry kind (expense/income/both), category, bank, payment mode, Need/Want, income source, amount range, text search. Show active filters as removable chips; "Clear all".

**Views/charts:**
1. Summary cards: total spent, total income, net (savings), average per day, biggest expense, transaction count, each with period delta.
2. Spending over time: bar/line by selected granularity (income vs expense overlay option).
3. Category breakdown: donut plus ranked bars; click a slice to drill in/filter.
4. Need vs Want share and trend.
5. By bank and by payment mode.
6. Income vs expense net trend (monthly/yearly).
7. Top expenses list for the period.
8. Calendar heatmap (daily spend; year view).
9. Weekly view: day-of-week pattern and weekly totals.
10. Table view of the filtered rows with sort, pagination and **CSV export of the current filter**.

**Implementation notes:** aggregate in SQL (views/RPC with `security_invoker`), not by shipping every row to the browser; keep dates as `date`; cache with sensible revalidation; skeleton loaders; charts must have accessible labels/text alternatives, readable tick formatting for PKR (thousands separators), tooltips on hover/tap, and responsive sizing (2-column grid on desktop, stacked on phone). Test with a seeded dataset of at least 2 years.

---

## 9. Google Sheet sync (Google Cloud service account)

Optional in setup; the app works fully without it. **One-way** (Supabase -> Sheet). Hand edits in the sheet are not read back.

**Columns (proposed, confirm with the owner — see Open items):**
`Date | Description | Category | Amount | Payment Mode | Bank Name | Type | Notes | Entry | ID`
- `Type` = Need/Want (kept from the old sheet). `Entry` = Expense/Income. `ID` = transaction UUID (used to find the row for updates/deletes; may be a hidden column).

**Behaviour:** create/edit -> upsert row; move to Trash -> remove row (or mark); restore -> re-add. All writes go through `sync_outbox` with retries and backoff. A daily cron drains failures and Settings has "Sync now" and "Full resync". Store the **spreadsheet ID** parsed from the pasted link plus the tab name. Changing the link is allowed and offers a full resync.

**Credentials:** the service account JSON key is entered in Settings (or env) and stored **encrypted** (section 10), never exposed to the browser.

**Setup guide to include in `SETUP.md` (Google Cloud, step by step, mark as optional):**
1. Open Google Cloud Console and create a project.
2. Enable the **Google Sheets API** for that project.
3. Create a **service account**; create a **JSON key** and download it.
4. Create (or open) the target Google Sheet. **Share it with the service account's email as Editor.**
5. Paste the sheet link, tab name and the JSON key in the app's Settings; press "Test connection".
(Verify the exact console menu names when writing the guide; they change.)

*Considered and not chosen:* an Apps Script web app with a secret token (simpler for non-technical users, no Cloud project). Could be added later as a second adapter.

---

## 10. Security requirements (non-negotiable)

1. **Nothing public.** Auth required on all app pages and APIs. `robots` noindex.
2. **RLS enabled on every table**; policies scope to `auth.uid()`. Add a check/audit query listing tables without RLS and run it before launch. Never ship a table without RLS.
3. **Keys:** only the Supabase URL and public (anon/publishable) key reach the browser. The service role key, `DATABASE_URL`, `ENCRYPTION_KEY`, `CRON_SECRET`, `SETUP_TOKEN` and Google credentials are **server-only** env vars. Never commit secrets.
4. **Secrets saved from Settings** (SMTP password, Google key): encrypt app-side (AES-256-GCM with `ENCRYPTION_KEY`), decrypt only on the server, never return them to the client (show masked).
5. **Setup wizard lock:** `/setup` requires `SETUP_TOKEN`, works only while no owner exists, then **disables itself permanently**.
6. **Cron/health routes** require `Authorization: Bearer $CRON_SECRET`.
7. Security headers (CSP, HSTS, frame-ancestors, referrer policy), secure cookie sessions, input validation with zod on every server action/route, parameterized queries only.
8. Auth hardening: generic error messages, rate limiting where possible, optional TOTP.
9. Soft delete + audit fields (`updated_at`). Provide CSV export as a backup path.
10. Test RLS with two users (user A must never read/write user B's rows) before release.

---

## 11. Keep-alive & cron

- Supabase free projects **pause after about a week of inactivity** (verify current policy). 
- `vercel.json` defines a **daily** cron hitting `/api/cron/keepalive` (does a trivial DB query) and `/api/cron/maintenance` (drain sync retries, purge expired trash). Vercel Hobby limits cron frequency (believed to be once per day; **verify**), and Vercel sends `Authorization: Bearer <CRON_SECRET>` when `CRON_SECRET` is set (**verify**).
- **n8n backup (owner has n8n):** Schedule trigger (hourly or daily) -> HTTP Request GET to `/api/cron/keepalive` with the bearer header. Document this in `SETUP.md` as optional.

---

## 12. Cloneability & setup flow

**Env vars (Vercel):** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or publishable key), `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `ENCRYPTION_KEY`, `CRON_SECRET`, `SETUP_TOKEN`, `NEXT_PUBLIC_APP_URL`.

**First-run wizard (`/setup`):**
1. Enter `SETUP_TOKEN`.
2. App verifies the database connection and runs migrations (creates tables, RLS policies, functions).
3. Create the owner account (email, username, password).
4. Optional steps: SMTP, Google Sheet, seed starter lists (or import suggestions), theme.
5. Wizard locks; redirect to login.

Each person who clones gets **their own Supabase project and Vercel project**; no shared database. Multi-user inside one instance is possible because every row has `user_id`, but is not required.

**Docs to produce:** `SETUP.md` with numbered guides: (1) Supabase project, (2) GitHub + Vercel deploy button, (3) SMTP provider options, (4) Google Cloud service account (optional), (5) Vercel Cron + optional n8n, (6) install on phone (Add to Home Screen), (7) updating the app, (8) troubleshooting.

---

## 13. Design system

> **The full, binding design rules are in Part B of this document (sections D1–D14)** (colour tokens, typography, shapes, layout breakpoints, components, motion, chart styling, review checklist). Read Part B before writing any UI. The summary below is only an overview; if the two ever differ, Part B wins.

- **Style:** Material You (Material 3), Pixel-like. Large rounded shapes, tonal surfaces, pill nav indicator, big friendly buttons. Chosen direction: **A (Pixel-pure Material You)**. B (calm editorial) and C (AMOLED dark-first) were alternatives; dark mode should still look excellent.
- **Colour:** single seed colour, default **deep teal**; user-adjustable in Settings. Expense = soft coral tone, Income = green tone, Need/Want = two distinct tonal chips. Android wallpaper colours are not available to web apps, so the seed is fixed unless the user changes it.
- **Theme:** follows `prefers-color-scheme`; Settings has System/Light/Dark; no flash on load; update `theme-color` meta.
- **Font:** system UI stack (San Francisco on Apple devices via `-apple-system`), then self-hosted **Inter** variable everywhere else. San Francisco cannot be self-hosted legally, Inter is its closest open sibling. (Roboto Flex was the first choice and was replaced on 2026-10-04.)
- **Motion:** shared-element and spring animations (Framer Motion); respect reduced motion.
- **Accessibility:** touch targets >= 48px, contrast AA, labels on icon-only items for assistive tech, focus rings for desktop.
- **Next step:** produce a **clickable mockup** (Add Expense with sentence form, history pull-down, swipe-to-trash, success animation, light + dark, plus one Insights screen on mobile and desktop). Get owner approval before building the real UI.

---

## 14. Offline & PWA

- Installable PWA (manifest, icons, standalone display).
- Offline queue (IndexedDB): entries made without signal are stored locally and pushed when online, with visible "pending" state and conflict-safe client-generated IDs.
- Cache the app shell; never cache authenticated API responses in a shared cache.

---

## 15. Roadmap & status

- [x] Requirements gathered, old sheet reviewed
- [x] Stack and security approach decided (this document)
- [~] 1. Design mockup — skipped at owner's request ("write the whole code first"); real UI built directly to Part B
- [x] 2. Owner created GitHub (`sufyan-dev29/expense-tracker`, private), Vercel (Hobby) and Supabase accounts/projects; keys collected. SMTP and Google Cloud still optional/pending
- [x] 2b. Deployed to Vercel; middleware 500 fixed (see section 19). Live URL `https://expense-tracker-omega-lilac-75.vercel.app`
- [~] 2c. First-run wizard (`/setup`): token accepted; database check was failing on the Direct connection host, owner switched `DATABASE_URL` to the Session pooler and redeployed; result not yet confirmed
- [ ] 2d. Run migrations, create owner account, set Supabase Auth Site URL, first sign-in
- [x] 3. Scaffold app, migrations, RLS, auth, setup wizard
- [~] 4. Add Expense / Income, history, swipe-to-trash, edit, defaults, success animation — coded; not yet exercised in a browser against a live Supabase project
- [x] 5. Settings (lists, templates, theme, formats) and encrypted secrets
- [~] 6. Insights (section 8) with seeded test data, mobile + desktop — coded; not yet exercised in a browser against a live Supabase project
- [x] 7. Google Sheet sync (service account), outbox, cron
- [x] 8. SMTP / auth email hook, Forgot password
- [~] 9. PWA, offline queue, polish — coded; not yet exercised in a browser against a live Supabase project
- [x] 11. UI overhaul (Material 3 Expressive, palette cards with AJAX apply and Generate, coloured option items, new nav, Inter/SF, light animations, new app icon, swipe gestures). Verified against a mock backend and simulated touch only; owner confirmed the first round looks good on the live site.
- [~] 10. Security audit: RLS two-user script written (`npm run test:rls`) and RLS logic verified on a local Postgres; must be run against the real Supabase project. `SETUP.md` written. Deploy button NOT added.

---

## 16. Open items — confirm with the owner before building the related part

1. **Sheet columns:** approve the proposed column list in section 9 (especially the `Entry` and `ID` columns). Should trashed entries be removed from the sheet or flagged?
2. **Monthly bundle** template group — wanted or not?
3. **Week definition:** Monday start and ISO week numbering OK?
4. **Seed data:** start lists empty, generic starter lists, or import the owner's current lists?
5. **Old data import:** import past months from the old sheet (CSV import) or start fresh?
6. **Username rules** and whether more than one user is ever needed.
7. Verify the "(verify)" claims in this document against current Supabase, Vercel and Google docs before relying on them.

---

## 17. Instructions to any LLM continuing this project

1. Read this whole document, including Part B (design system). Treat sections 2 and 10 of Part A, and all of Part B, as binding. Do not invent a different look; if you think the design should change, ask the owner and log it.
2. Do not assume answers to section 16 items; ask the owner briefly, with your recommended default.
3. Never hardcode lists, URLs, emails, colours that should be settings. Never put secrets in client code or commits.
4. Build in the order of section 15. After each phase, update the checklist and the decision log (section 18).
5. Test: build passes, RLS two-user test, auth redirects, mobile and desktop viewports, dark/light, offline queue, sync retry.
6. The owner prefers a calm, honest tone: flag trade-offs and risks instead of agreeing blindly.
7. Deliverables for each phase should be runnable code plus short step-by-step instructions for the owner (they will deploy on Vercel and Supabase themselves).

---

## 18. Decision log (append new entries here)

- 2026-10-04: Chose Supabase over self-hosted PocketBase (no VPS involvement; less maintenance).
- 2026-10-04: Chose Google Cloud service account for sheet sync; Apps Script considered, not chosen.
- 2026-10-04: Vercel Cron for keep-alive; n8n as optional backup.
- 2026-10-04: Design direction A (Pixel-style Material You), teal seed, light + dark.
- 2026-10-04: Analytics by week/month/year with filters and desktop optimization is a priority feature.
- 2026-10-04: Added a binding design system (now Part B of this document) so every contributor or LLM builds the same UI. Colours are generated from a seed (default teal), never hardcoded.
- 2026-10-04: Merged the former PROJECT_SPEC.md and DESIGN.md into this single file.
- 2026-10-04: Built the full app in one pass. Section 16 answered with defaults (owner has not yet replied): sheet columns as proposed, trashed entries removed from sheet, monthly bundle included, Monday/ISO weeks (week start configurable), starter lists preloaded (optional toggle in setup), no old-data import, single user.
- 2026-10-04: Password reset emails are generated server-side (`admin.generateLink` + app SMTP) instead of relying on the Supabase Send Email hook; the hook route exists as optional. Reason: works without dashboard configuration and cannot lock the owner out.
- 2026-10-04: Setup wizard covers token, migrations, owner account. SMTP and Google Sheet are configured in Settings after first login (not inside the wizard).
- 2026-10-04: Verified: Supabase free projects pause after ~7 days of low activity; Vercel Hobby cron = once per day, fires anywhere within the scheduled hour, sends CRON_SECRET as `Authorization: Bearer`.
- 2026-10-04: NOT built: TOTP two-factor, Deploy-to-Vercel button, CSV import, `/dev/design` review route, Lighthouse pass, real-device PWA/offline testing.
- 2026-10-04: Deployment: owner pushed via VS Code + git (GitHub web upload drops dot-files and caps at 100 files). Git identity set globally.
- 2026-10-04: Added `"framework": "nextjs"` to `vercel.json` after a production 500 `MIDDLEWARE_INVOCATION_FAILED` (runtime log: raw `middleware.js` with `import ... from '@/...'` run as CommonJS). Cause was Vercel treating root `middleware.ts` as standalone Routing Middleware because the project's Framework Preset was not Next.js. Site loads after the fix and redeploy.
- 2026-10-04: Learned: Vercel variables marked Sensitive cannot be revealed after saving; to change one, edit and re-enter it. Environment variable changes only apply to a NEW deployment (redeploy).
- 2026-10-04: Learned: `DATABASE_URL` must be the Supabase **Session pooler** string (host `aws-0-<region>.pooler.supabase.com`, port 5432, user `postgres.<project-ref>`). The Direct `db.<ref>.supabase.co` host fails from Vercel with `getaddrinfo ENOTFOUND` (IPv6-only on free plan). Project region: ap-southeast-2.
- 2026-10-04: Owner wants to change the Vercel domain later (free `.vercel.app` alias or a custom subdomain). Rule: after any domain change, update `NEXT_PUBLIC_APP_URL` and Supabase Auth Site URL, then redeploy.
- 2026-10-04: Possible hardening, not done: trim whitespace on both sides of the setup token comparison in `app/api/setup/route.ts`.
- 2026-10-04 (UI redesign after owner review): Material 3 Expressive pass. (1) Pull-to-refresh: `overscroll-behavior: none` on `<html>` AND `<body>` (Chrome's pull-to-refresh belongs to the root scroller; the old rule was on body only) and the old pull-down gesture was replaced (round 2 re-adds it as a deliberate JS gesture that only opens History; see below); the History button in the header also opens it. (2) Navigation: 64dp bottom bar with 56x32 pill indicator and always-visible labels below 840px; 96dp rail 840-1199px; expanded 288px rail with user chip from 1200px. (3) Font: system UI stack (`-apple-system` = San Francisco on Apple devices) then self-hosted Inter, because SF cannot be licensed for self-hosting on Windows/Android; Roboto Flex removed. (4) Palettes: picker shows palette cards (primary/tertiary/secondary/container quadrants) with a Generate button; palettes are fetched and applied over AJAX (`/api/theme/css`, `/api/theme/palettes`), CSS variables are swapped in the `<style id="user-theme">` element, no reload. A palette = seed + style (tonal, vibrant, expressive, neutral, fruit, rainbow, content) stored in the existing `user_settings.accent_hex` text column as `#RRGGBB` or `#RRGGBB:style` (no migration). (5) Every bank, payment mode, category and income source gets its own colour and icon (8 fixed hues harmonised to the seed; each kind starts at a different hue; owners can override colour and icon for every list). (6) Save button animation rewritten as pure state + CSS (idle, saving, done); the old version called an animation control before the checkmark existed and could get stuck. (7) Light motion: page fade-in, staggered list rise, pop on selection, glide on theme change; all disabled under prefers-reduced-motion.
- 2026-10-04 (UI round 2): New app icon (tonal wallet + coin, rendered by `app/icons/[size]/route.tsx`; `/icons/apple` is the full-bleed iOS icon; icon URLs carry `?v=2` and the service worker cache is `et-static-v2` so old icons are not served from cache; bump both when the icon changes). Pickers never raise the keyboard: `Sheet` blurs any focused text field on open and does not restore focus to text fields; select sheets have no autofocus. Touch gestures: `useSwipeDismiss` (components/ui) lets any sheet or the full-screen History panel be dragged down to close (only from the top bar or content scrolled to its top; inputs and `[data-no-swipe]` rows are ignored); `EntryScreen` re-adds pull-down-from-top to open History on screens under 1024px (browser pull-to-refresh stays disabled in CSS). Adding a category/bank/mode/source from the picker now shows a live icon preview that follows the name (keyword matcher `defaultIconFor` in `lib/seed.ts`), plus icon and colour pickers (`components/IconColorPicker.tsx`); `ICON_CHOICES` is shared with Settings.
- 2026-10-05 (Sheet sync fixes): (1) Trashed entries were not removed from the Google Sheet because `lib/sheets.ts` did not select `deleted_at`, so the soft-delete check never saw it; fixed (`SELECT` and `Row` now include it). Entries already trashed before the fix stay in the sheet until **Settings, Google Sheet, Full resync**. (2) The Date column showed serial numbers (46300) when the column was formatted as a number; `formatDateColumn` now sets column A to a date format (`dd mmm yyyy`) on connect, on every sync and on full resync. Tested with a mocked Sheets client, not against real Google.
- 2026-10-05 (History spacing): History rows put the name and amount on one line and the bank / payment-mode pills on a second full-width line (no truncated or unevenly wrapped pills); the phone History panel uses the same 16px side gutter as its search bar; date headings are no longer grey bands (`--hist-bg` matches the panel); on the desktop side card rows use `--hist-card` so they stay visible. `HistoryList` reads `--hist-bg` and `--hist-card` from its container.

---

## 19. Deployment state & runbook (start here to resume)

No secrets are recorded here. The owner keeps real values in Bitwarden.

### 19.1 Where things are

| Item | State |
|---|---|
| GitHub repo | `sufyan-dev29/expense-tracker`, private, branch `main` |
| Vercel project | `expense-tracker`, Hobby plan, team `sufyan-s-team1` |
| Live URL | `https://expense-tracker-omega-lilac-75.vercel.app` |
| Supabase project | ref `kwkewywzuaivcyshiqho`, region ap-southeast-2 (Sydney pooler host) |
| Site loads | Yes (middleware fix applied) |
| `/setup` token step | Passed |
| `/setup` database step | Retrying after switching `DATABASE_URL` to the Session pooler; confirm |
| Migrations, owner account, sign-in | Not done (as of the last summary; confirm) |
| UI | Overhaul round 1 deployed and approved by the owner; round 2 (icon, no keyboard on pickers, swipe gestures, icon picker) delivered as `expense-tracker-ui-update2.zip`, to be pushed |
| Owner's machine | Windows, VS Code, Git installed and configured |

### 19.2 Environment variables (Vercel, Production)

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (Session pooler), `ENCRYPTION_KEY`, `CRON_SECRET`, `SETUP_TOKEN` (changed during troubleshooting to a simple value; may be replaced by a long random one after setup), `NEXT_PUBLIC_APP_URL` (added; needs a redeploy to take effect). Sensitive variables cannot be read back; re-enter to change. Always redeploy after changes.

### 19.3 Resume checklist

1. Vercel, Deployments: top entry is Ready and Current.
2. Open `/setup` in a private window, enter `SETUP_TOKEN`, Check connection.
   - `getaddrinfo ENOTFOUND db...supabase.co`: `DATABASE_URL` is the Direct string; use the Session pooler.
   - Authentication failed or tenant/user not found: wrong password or missing `postgres.<ref>` username. Reset the DB password (Supabase, Project Settings, Database), prefer letters and numbers, update `DATABASE_URL`, redeploy.
   - Wrong setup token: token env var not live yet (redeploy), stray whitespace, or a password manager filling an old value. If it persists, add `.trim()` to both sides of the comparison.
3. Run migrations, then create the owner account (10+ char password; save it to Bitwarden first). The wizard locks itself.
4. Supabase, Authentication, URL Configuration: set Site URL to the live URL. Confirm "Allow new users to sign up" is off.
5. Sign in with email or username. Exercise: add expense, add income, templates, swipe to Trash and restore, Insights (day/week/month/year), Settings.
6. Install on phone (Chrome, Add to Home screen) and test swipe, pull-down, success animation and offline queue on a real device.

### 19.4 Optional follow-ups

- Custom domain or a nicer `.vercel.app` alias (Vercel, Settings, Domains); then update `NEXT_PUBLIC_APP_URL` and the Supabase Site URL and redeploy.
- SMTP in Settings (then Send test email) so Forgot password works.
- Google Sheet sync: service account JSON, share the sheet with its email as Editor, Settings, Connect, Full resync.
- n8n daily GET to `/api/cron/keepalive` with `Authorization: Bearer <CRON_SECRET>` as a backup to the Vercel cron.
- Run `npm run test:rls` locally against the real project and confirm `select * from public.rls_audit();` returns no rows.
- Re-ask the owner the section 16 questions; defaults were used so far.

### 19.5 Gotchas found during deployment

- Git: `git config --global user.name/user.email` is required before the first commit. A new install needs VS Code or the PC restarted before `git` is on PATH.
- GitHub web upload skips dot-files and is limited to 100 files; use git.
- The first deploy failed at runtime with a middleware 500 until `"framework": "nextjs"` was set (and the Framework Preset in Vercel was Next.js). In the build log, a line like "Detected Next.js version" confirms it.
- Vercel Hobby is for personal, non-commercial use.
- Windows PowerShell blocks `npm` ("running scripts is disabled"). Fix: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`, or use `npm.cmd install`.
- Installed PWA icons and the service worker cache icons; after changing the icon bump the `?v=` query in `app/layout.tsx` and `app/manifest.ts` and the cache name in `public/sw.js`. Android may need the app removed and re-added to show a new home-screen icon.
- Palettes live in `user_settings.accent_hex` as `#RRGGBB` or `#RRGGBB:style`; do not tighten that validation without migrating existing rows.
- `lib/palette.ts` holds the pure palette helpers so client code does not pull `@material/material-color-utilities` into the browser bundle; only import `lib/theme.ts` on the server or edge.

---

# PART B — DESIGN SYSTEM

> Binding. If you want to deviate, ask the owner first and record the change in section D14.
## D1. Design intent

- **Feel:** a native Google Pixel app. Material 3 / Material You: calm, tonal, rounded, friendly, fast.
- **Priority:** logging an entry must feel effortless. Reduce taps, reduce reading, reduce decisions.
- **Platforms:** phone first, but **desktop is a first-class layout** (rail/drawer navigation, two panes, wide dashboards), not a stretched phone screen.
- **Themes:** light and dark are equal citizens. Follow the system setting by default, with a manual override in Settings.

### Must NOT look like generic AI output

Do not use any of the following:
- Purple/blue/pink gradients, gradient hero blobs, glow effects or neon accents
- Glassmorphism / frosted cards / heavy blur
- Emoji as icons or as decoration
- Stacked drop shadows (use **tonal elevation**: surface colour steps, not shadows)
- Centered-everything marketing layouts, oversized hero text, "stat card soup"
- Unmodified default component-library styling (default shadcn/Bootstrap look). Restyle to these tokens.
- Inter/system-default typography without the type scale below

---

## D2. Colour

### D2.1 Method
- Use **one seed colour** and generate the full Material 3 tonal palette with `@material/material-color-utilities` at build/run time, for both light and dark schemes. The seed is user-adjustable in Settings > Appearance, so **never hardcode the hex values below in components**. Components only use CSS variables.
- **Default seed:** deep teal `#006A6A`.
- Expose tokens as CSS variables named `--md-sys-color-<role>` (for example `--md-sys-color-primary`) and map Tailwind colours to those variables.
- Generate and **harmonize** the semantic colours (expense, income) toward the seed so they sit naturally in the palette.

### D2.2 Reference values for the default teal seed (for design/mockup checking only; the generator is the source of truth)

| Role | Light | Dark |
|---|---|---|
| primary | `#006A6A` | `#4CDADA` |
| on-primary | `#FFFFFF` | `#003737` |
| primary-container | `#6FF7F6` | `#004F4F` |
| on-primary-container | `#002020` | `#6FF7F6` |
| secondary-container | `#CCE8E7` | `#334B4B` |
| tertiary-container | `#D3E4FF` | `#334863` |
| surface | `#F4FBFA` | `#0E1514` |
| surface-container-low | `#EFF5F4` | `#161D1D` |
| surface-container | `#E9EFEE` | `#1A2121` |
| surface-container-high | `#E3E9E9` | `#252B2B` |
| surface-container-highest | `#DEE4E3` | `#303636` |
| on-surface | `#161D1D` | `#DEE4E3` |
| on-surface-variant | `#3F4948` | `#BEC9C8` |
| outline | `#6F7979` | `#899392` |
| outline-variant | `#BEC9C8` | `#3F4948` |
| error | `#BA1A1A` | `#FFB4AB` |

(Values are close to Material's generated teal scheme; regenerate rather than trusting them exactly.)

### D2.3 Semantic colours
- **Expense:** a soft coral/terracotta family (main + container + on-container), harmonized to the seed. Used for expense amounts, the Add Expense CTA accent chip and expense chart series.
- **Income:** a green family (main + container + on-container), harmonized. Used for income amounts and income chart series.
- **Need / Want:** two distinct tonal chips: **Need** uses `secondary-container`, **Want** uses `tertiary-container`. Never rely on colour alone: include the text label.
- **Destructive (trash/delete):** the `error` role.
- Category colours (charts, avatars): a fixed set of ~8 tonal hues derived from the seed's palette. A category keeps its colour across the whole app. Users can override per category in Settings.

### D2.4 Rules
- Backgrounds use `surface` roles. Elevation = moving up the `surface-container-*` steps.
- Text on any surface meets WCAG AA contrast.
- Light and dark must both be checked for every screen before it is considered done.

---

## D3. Typography

- **Font:** `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Inter Variable', 'Inter', system-ui, 'Segoe UI', Roboto, sans-serif`. Inter is self-hosted via `@fontsource-variable/inter`; SF is used only where the device already has it. The type scale below is tuned for Inter (slightly heavier weights: 600 for titles and headlines, tight negative tracking on large sizes).
- Use **tabular numerals** (`font-variant-numeric: tabular-nums`) for every amount, total and axis label so numbers align.
- Type scale (Material 3):

| Role | Size / Line height | Weight | Use |
|---|---|---|---|
| Display Medium | 45 / 52 | 400 | Big amount on the add form (can scale down for long numbers) |
| Headline Small | 24 / 32 | 400 | Screen titles, key totals |
| Title Large | 22 / 28 | 400 | Section titles, top bar |
| Title Medium | 16 / 24 | 500 | List titles, CTA label |
| Body Large | 16 / 24 | 400 | Default text, sentence-form tokens |
| Body Medium | 14 / 20 | 400 | Secondary text, notes |
| Label Large | 14 / 20 | 500 | Buttons, chips |
| Label Medium | 12 / 16 | 500 | Nav labels, captions, chart ticks |

- Sentence case everywhere ("Add expense", not "ADD EXPENSE" or "Add Expense" in running UI). The CTA text is specified in Part A, section 7.2.
- Currency format: `Rs 22,000` (thousands separators, no decimals unless the value has paise; currency symbol/format configurable in Settings). Dates: `Thu, 10 Sep` (year shown when not the current year).

---

## D4. Shape, spacing, elevation

- **Corner radius tokens:** extra-small 4 · small 8 · medium 12 · large 16 · extra-large 28 · full (pill).
  - Buttons, chips, nav indicator: **full**. Cards/list containers: **large (16)**. Bottom sheets and dialogs: **extra-large (28)**. Text fields: **medium/large**.
- **Spacing:** 4 px base grid (4, 8, 12, 16, 24, 32, 48).
- **Page padding:** 16 (phone), 24 (tablet), 32 (desktop). Max content width: 560 for forms, 1280 for dashboards.
- **Touch targets:** at least 48 x 48 px.
- **Elevation:** tonal (surface-container steps). Shadows only on floating overlays (menus, snackbars) and kept subtle.

---

## D5. Layout & navigation

| Window class | Width | Navigation | Layout |
|---|---|---|---|
| Compact | < 840 | **Bottom navigation bar** (64dp, 56x32 pill indicator, icon over label, labels always shown) | Single column |
| Medium / Expanded | 840–1199 | **Collapsed rail** (96dp, same pill indicator) | Single column up to 1023px; from 1024px form + permanent history card |
| Large | 1200+ | **Expanded rail** (288dp, icon + label in a full-width pill, brand mark, user chip) | Two panes; dashboards use a 12-column grid |

- **Tabs:** Expense, Income, Insights, Settings. Order fixed. Icons from **Material Symbols Rounded** (weight 400; **filled** variant for the selected item, outlined otherwise). Labels are always shown (Material 3 Expressive); the selected item gets the pill indicator and filled icon.
- Top app bar: small, title only, minimal actions (for example Trash on the history view, sync status chip).
- Respect safe areas (notch, gesture bar) and `env(safe-area-inset-*)`.
- Desktop: hover states, visible focus rings, keyboard shortcuts (for example `N` new entry, `/` search), right-click or hover row actions, persistent history panel.

### D5.1 Wireframe — Add Expense (phone)

```
┌────────────────────────────┐
│ Add expense          ⟳  🗑 │  top bar (sync chip, trash)
│ [Fuel][Milk][PTCL][+]      │  template chips (horizontally scrollable)
│                            │
│ I spent                    │
│   Rs  0                    │  Display Medium amount, big keypad on tap
│ on  [ Expense name ]       │  tonal token
│ paid from [ Bank ▾ ]       │  opens bottom sheet
│ via [ Payment mode ▾ ]     │
│ on  [ Today ▾ ]            │
│ ───────────────────────    │
│ Category   [ Education ▾ ] │
│ [ Need | Want ]            │  segmented button
│ Notes      [ ........ ]    │
│                            │
│ ( Add expense          )   │  full-width pill CTA, 56 high
├────────────────────────────┤
│  💸    ＋    📊    ⚙       │  bottom nav (use Material Symbols, not emoji)
└────────────────────────────┘
   pull down → history sheet
```
(Emoji in the wireframe are placeholders; real icons are Material Symbols.)

### D5.2 Wireframe — desktop (>= 840)

```
┌──────┬───────────────────────────┬───────────────────────┐
│ rail │  Add expense (form, max   │  History (persistent) │
│      │  560 wide, centered in    │  grouped by date,     │
│  ●   │  the left pane)           │  search + filters,    │
│  ●   │                           │  click row to edit    │
│  ●   │  Templates strip on top   │                       │
└──────┴───────────────────────────┴───────────────────────┘
```

---

## D6. Core components

- **Sentence form:** the signature interaction. Body-large text with inline **tonal tokens** (filled with `surface-container-high`, 12 radius, 8x12 padding). Tapping a token opens the matching control: numeric keypad (amount), keyboard (name), bottom sheet list (bank, payment mode, category), date picker (date). Desktop opens popovers/dialogs instead of full sheets.
- **Select sheets:** searchable list, selected item has a check and `secondary-container` background, an "Add new..." row at the bottom that lets the user add an option on the spot.
- **Segmented button (Need/Want):** two options, pill outline, selected fills with its tonal colour.
- **Chips (templates, filters):** assist/filter chips, 32 high, pill. Long-press a template chip to edit.
- **Primary CTA:** full-width filled button, 56 high, pill, Title Medium label. It sits in the thumb zone. Disabled until the minimum is valid (amount greater than 0 and a name entered).
- **History row:** leading circular category icon (category colour, tonal), title (name), subtitle (`Bank · Payment mode`), trailing amount (expense coral / income green, tabular), date group headers. Row height >= 64.
- **Swipe to trash:** swipe left reveals an `error`-container background with a trash icon; releasing past the threshold moves the entry to Trash and shows a **snackbar with Undo** (about 5 s). Tap row = edit in the same form.
- **Snackbar, dialog, menu:** Material 3 styling; destructive confirms only for permanent deletion.
- **Empty states:** a simple illustration made from tonal shapes and one short sentence plus one action. No stock art.
- **Loading:** skeleton shapes in `surface-container` tones, no spinners on full screens.
- **Forms in Settings:** grouped lists (card per section), switches, outlined text fields, secrets masked with a reveal-once pattern.

---

## D7. Motion

- Easing: Material emphasized `cubic-bezier(0.2, 0, 0, 1)`; use springs for sheets and swipes. Durations: small 150–200 ms, medium 250–350 ms, large 400–500 ms.
- Use shared-element/container transforms between a history row and the edit form where practical.
- **Success animation (Google Wallet style), total <= ~1.4 s:**
  1. 0–120 ms: button presses (scale 0.97).
  2. 120–420 ms: button width collapses into a circle (radius full), label fades out.
  3. 420–800 ms: circle fills with `primary`, check mark **draws** along its path (stroke-dashoffset), gentle overshoot.
  4. At the check: haptic via `navigator.vibrate(20)` where supported.
  5. 800–1200 ms: soft ripple expands, form values clear (defaults for the remembered fields stay), button returns to normal width.
  - Input must never be blocked for more than ~1 s. If saving is still pending (offline), show the success state and a small "pending sync" marker on the entry.
- **Reduced motion** (`prefers-reduced-motion`): replace everything with a quick fade and a static check.
- Pull-down history: sheet follows the finger with resistance, snaps open/closed. Disable the browser's own pull-to-refresh in standalone mode (`overscroll-behavior: contain`).

---

## D8. Insights (charts & data) styling

- Charts use theme tokens (series colours from the expense/income/category sets), **rounded bar tops (4 px)**, light horizontal gridlines only (`outline-variant` at low opacity), no 3D, no gradients, no chart borders.
- Axis labels in Label Medium with tabular numerals; large numbers abbreviated on axes only (`12.5k`), full values in tooltips.
- Tooltips: `surface-container-highest`, medium radius, appear on hover (desktop) and tap (phone). Always show period, value and share where relevant.
- Every chart has a title, a short text summary for screen readers, and a table view toggle.
- **Phone:** filter bar becomes a horizontally scrolling chip row plus a "Filters" bottom sheet; cards stack. **Desktop:** persistent filter bar at top, 2–3 column card grid, charts resize smoothly; the data table sits below.
- Granularity switch (Day / Week / Month / Year) and range presets use a segmented button / dropdown; active filters show as removable chips.
- Summary cards: label (Label Medium), value (Headline Small, tabular), delta chip (green/coral with arrow icon and text).

---

## D9. Auth, setup and settings screens

- Login, forgot and reset: centered card on `surface-container-low`, max 400 wide, app name, two fields, one primary button, secondary text links. No marketing copy.
- Setup wizard: a stepper (numbered steps), one task per screen, clear "Test connection" actions with success/error states, and a short "why we need this" line. Optional steps (SMTP, Google Sheet) show a Skip action.
- Settings: grouped sections as cards; each section has a title, a short description and its controls. Dangerous actions are grouped at the bottom.

---

## D10. Iconography & imagery

- **Material Symbols Rounded** only, self-hosted. Consistent weight (400), optical size 24 (20 in dense desktop tables).
- Icons for categories, banks, payment modes and income sources: a shared curated set (`ICON_CHOICES` in `lib/seed.ts`); the default is chosen from the name by a keyword matcher (`defaultIconFor`) and is always editable, including live while adding a new item from the picker.
- No raster illustrations. App icon: tonal wallet with a coin on the default teal seed, generated at `/icons/192`, `/icons/512`, `/icons/maskable` and `/icons/apple` (full-bleed 180px for iOS). A monochrome version is not yet provided. `theme-color` meta follows the active theme.

---

## D11. Accessibility & quality bar

- WCAG AA contrast, 48 px targets, visible focus, full keyboard operation on desktop, semantic landmarks, labels for icon-only controls, form errors announced.
- Works in both orientations; no horizontal scroll at 320 px width.
- Text scales with the user's font-size setting; layouts must not break at 130% text size.
- Performance: Lighthouse mobile performance and accessibility targets of 90+; avoid layout shift (reserve space for skeletons and fonts).

---

## D12. Implementation notes

- Theme tokens live in one place (`/lib/theme`): seed -> generated scheme -> CSS variables. Dark/light switching sets a class or `data-theme` on `<html>` **before first paint** (inline script) to avoid a flash. Persist the choice in the user's settings row and in local storage.
- Build a small internal component library (`/components/ui`) that follows sections D4–D6. Screens compose those components; do not style ad hoc.
- Use Framer Motion for the success animation, sheet and swipe gestures; keep animation code in dedicated components.
- Provide a `/dev/design` route (development only, behind auth) that shows every component, state and chart in light and dark for visual review.

---

## D13. Review checklist (a screen is not done until all are true)

- [ ] Uses only tokens (no hardcoded colours, radii or font sizes)
- [ ] Looks right in light and dark, at phone and desktop widths
- [ ] Matches the approved mockup
- [ ] Amounts are tabular, formatted for PKR, and colour-coded by kind
- [ ] Touch targets >= 48 px; keyboard and screen reader checked
- [ ] Empty, loading, error and offline states designed
- [ ] None of the "must not look like AI" items from section D1 are present
- [ ] Reduced-motion behaviour verified

---

## D14. Change log (append here)

- 2026-10-04: Initial baseline: Material 3, Pixel-style, teal seed `#006A6A`, Roboto Flex, tonal elevation, light/dark.
- 2026-10-04: Redesign to Material 3 Expressive: Inter / SF type, 28px containers, connected button groups, palette cards, coloured option chips, new navigation (see decision log).
- 2026-10-04 (round 2): New wallet app icon (`?v=2`, service worker cache `et-static-v2`); pickers never open the keyboard; swipe down closes sheets and History; pull down from the top opens History; add-new picker has live icon preview plus icon and colour rows; much wider keyword to icon matching.
