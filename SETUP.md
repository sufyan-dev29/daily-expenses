# Setup guide

Everything here uses free tiers. Allow about 30 minutes the first time.
Menu names on Supabase, Vercel and Google change from time to time; if a label differs slightly, look for the closest match.

**Order:** 1 Supabase → 2 Secrets → 3 GitHub → 4 Vercel → 5 First run → 6 Phone. Sections 7 to 10 are optional.

---

## 1. Supabase project (database + login)

1. Sign in at [supabase.com](https://supabase.com) (GitHub login is fine) and click **New project**.
2. Choose a region near you (for Pakistan, Mumbai or Singapore if offered). Set a strong **database password** and save it.
3. When the project is ready, collect these values:

| Value | Where to find it |
|---|---|
| Project URL | Project Settings → API |
| anon / publishable key | Project Settings → API |
| service_role key | Project Settings → API (**secret**: bypasses all security rules) |
| `DATABASE_URL` | Click **Connect** at the top → **Session pooler** → copy the URI and replace `[YOUR-PASSWORD]` with your database password |

   Vercel needs the **pooler** string, not the "direct connection" one (direct is IPv6-only on the free plan).
4. Authentication → Sign In / Providers → turn **off** "Allow new users to sign up". The setup wizard creates your account instead.
5. Authentication → URL Configuration: set **Site URL** to your Vercel URL once you have it (section 4).

## 2. Generate three secrets

Run in any terminal (your VPS works) and save each result somewhere safe:

```bash
openssl rand -base64 32   # ENCRYPTION_KEY
openssl rand -hex 32      # CRON_SECRET
openssl rand -hex 32      # SETUP_TOKEN
```

If you lose `ENCRYPTION_KEY`, the saved SMTP password and Google key become unreadable and must be re-entered.

## 3. GitHub

1. Create a **private** repository named `expense-tracker` (empty, no README).
2. Upload this project's files to it. With git:
   ```bash
   cd expense-tracker
   git init && git add . && git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR-USER/expense-tracker.git
   git push -u origin main
   ```
   `.env.local` is git-ignored. Never commit real keys.

## 4. Vercel

1. Sign in at [vercel.com](https://vercel.com) with GitHub, choose the **Hobby** plan, then **Add New → Project** and import the repo.
2. Before deploying, open **Environment Variables** and add:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
| `DATABASE_URL` | Session pooler string |
| `ENCRYPTION_KEY` | from section 2 |
| `CRON_SECRET` | from section 2 |
| `SETUP_TOKEN` | from section 2 |

3. Click **Deploy**. Copy the live URL (for example `https://expense-tracker-xyz.vercel.app`).
4. Add one more variable, `NEXT_PUBLIC_APP_URL` = that URL, then **Redeploy** (Deployments → ⋯ → Redeploy).

Vercel Hobby is for personal, non-commercial use. A private expense tracker fits; offering this to paying customers would need a Pro plan.

## 5. First run

1. Open `https://your-url/setup`.
2. Enter your `SETUP_TOKEN` → **Check connection**.
3. **Run migrations** (creates tables and security rules; safe to repeat).
4. Create the owner account (email, username, password of 10+ characters). Leave "Preload starter lists" on if you want the categories, banks and payment modes from your old sheet; everything is editable later.
5. The wizard locks itself permanently. Sign in with your email **or** username.

## 6. Install on your phone

Open the URL in Chrome on Android → ⋮ menu → **Add to Home screen** (or **Install app**). On iPhone use Safari → Share → **Add to Home Screen**.

---

## 7. Email for password resets (optional but recommended)

Password sign-in works without it, but "Forgot password" needs to send email. Supabase's built-in sender is heavily rate-limited and meant for testing, so use an SMTP provider. Free options: Brevo, Resend, or Gmail with an app password.

1. Create an account with a provider and note: host, port, username, password, and a verified sender address.
2. In the app: **Settings → Email (SMTP)**. Port 587 with "Implicit TLS" off, or port 465 with it on.
3. Press **Save**, then **Send test email**.

Reset emails are sent by the app itself through this SMTP, so there is nothing to change in the Supabase dashboard. (Optional: to route *all* Supabase auth emails through it, set an Auth **Send Email hook** to `https://your-url/api/auth/send-email` and put its secret in `SEND_EMAIL_HOOK_SECRET`.)

## 8. Google Sheet sync (optional)

One-way copy of every entry into a sheet. Edits made in the sheet are not read back.

1. Open [Google Cloud Console](https://console.cloud.google.com) and create a project.
2. **APIs & Services → Library**: enable **Google Sheets API**.
3. **IAM & Admin → Service Accounts → Create service account**. Then open it → **Keys → Add key → Create new key → JSON**. A file downloads.
4. Create a new Google Sheet (or open one). Click **Share** and add the service account's email (it looks like `name@project.iam.gserviceaccount.com`) as **Editor**.
5. In the app: **Settings → Google Sheet**. Paste the JSON file contents, press **Save key**, paste the sheet link and tab name, then **Connect**. The header row is written for you:
   `Date | Description | Category | Amount | Payment Mode | Bank Name | Type | Notes | Entry | ID`
6. **Full resync** copies everything that already exists.

Trashed entries are removed from the sheet; restoring brings them back. Failed syncs retry automatically (and daily via cron).

## 9. Keep-alive and cron

Supabase free projects pause after about **7 days of low activity**. `vercel.json` already schedules two **daily** jobs: `/api/cron/keepalive` and `/api/cron/maintenance` (purges expired Trash, retries failed sheet syncs). Vercel sends your `CRON_SECRET` automatically as `Authorization: Bearer …`.

Notes: on Hobby, cron runs at most once a day and may fire any time within the scheduled hour. Vercel does not retry a failed cron, so a backup is cheap insurance.

**Optional n8n backup:** Schedule Trigger (daily) → HTTP Request, method GET, URL `https://your-url/api/cron/keepalive`, header `Authorization: Bearer <CRON_SECRET>`.

## 10. Updating the app

Push changes to GitHub; Vercel redeploys automatically. After pulling or copying in a new version, run `npm install` first (dependencies can change). New database changes ship as numbered files in `supabase/migrations/`. `/setup` is locked once your account exists, so apply any new migration yourself with:
```bash
psql "$DATABASE_URL" -f supabase/migrations/002_whatever.sql
```
or paste the file into the Supabase **SQL Editor**.

---

## Before you trust it with real data

```bash
cp .env.example .env.local     # fill in the values
npm install
npm run test:rls               # two-user security test: must print "All RLS checks passed"
npm run seed:demo              # optional: 2 years of fake data to try Insights
npm run seed:demo -- --clear   # remove the fake data
```

In the Supabase SQL Editor, `select * from public.rls_audit();` must return **no rows** (it lists any table missing row-level security).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `/setup` says "Missing environment variables" | Add them in Vercel, then redeploy |
| Migration step fails to connect | Use the **Session pooler** string and the right database password |
| Can't sign in with username | Usernames are lowercase; try your email |
| "Forgot password" email never arrives | Settings → Email → **Send test email**; check spam; check provider logs |
| Sheet "Access denied" | Share the sheet with the service account email as **Editor** |
| Sheet "Tab not found" | Tab name must match exactly, including capitals |
| Supabase project paused | Dashboard → Restore. Check the daily cron ran (Vercel → Settings → Cron Jobs) |
| Changed palette looks unchanged | Palettes apply instantly without a reload; if it doesn't, check you are online (it saves to your account) and hard refresh |
| `npm` fails on Windows with "running scripts is disabled" | Run `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` once, or use `npm.cmd` |
| App icon on the phone is old or missing | Remove the installed app and add it to the home screen again (icons are cached) |
