# How Daily Expenses is built

This document is for developers and anyone curious about what is inside the app.

## The big picture

```
 Android app (Capacitor shell)
 ├── WebView  ──►  the screens (Next.js static export, React, Tailwind, Material 3)
 │                    │
 │                    ▼
 │               core/  (TypeScript logic, unit-tested in Node)
 │                    │  talks to
 │                    ▼
 │               encrypted SQLite (SQLCipher, one database per account)
 └── Native plugins: SQLite, Filesystem, Share, Network, App, BiometricVault (ours)
```

The app is the original web expense tracker packaged as a native Android app. The screens, Material 3 styling and animations are the same code. The server (Supabase, email, Vercel) was removed and replaced by a database on the phone. The original web app repo is untouched.

## Layers

### 1. Screens: `app/`, `components/`, `lib/`
Next.js 15 with `output: 'export'`, so the build is plain static files that ship inside the APK. There are no server routes. React 19, Tailwind, Framer Motion and Recharts draw the UI; colours come from Material Color Utilities.

- `components/auth/`: sign-in, create account, recovery code, restore, session handling and auto-lock.
- `components/settings/`: appearance, lists, templates, Google Sheet, data (backup, restore, CSV) and security.
- `lib/local/`: glue between the screens and the phone: opening the database, saving and sharing files, picking files, biometrics, sync triggers.

### 2. Logic: `core/`
All business logic is plain TypeScript with no framework, so it can be tested quickly in Node (`node --experimental-strip-types --test core/*.test.ts`, 88 tests).

| File | Job |
| --- | --- |
| `db.ts`, `schema.ts` | Database interface and versioned migrations |
| `localclient.ts` | A small query layer shaped like the old Supabase calls, so the original screens work unchanged. Only whitelisted tables and columns, all values bound as parameters |
| `money.ts`, `insights.ts` | Money kept as whole minor units; the charts and summaries |
| `auth.ts` | Accounts, password hashing, lock-out, recovery code, biometric slot |
| `backup.ts`, `zip.ts`, `bytes.ts` | Backup file: hand-written zip + AES-256-GCM, with limits against malicious files |
| `csv.ts` | CSV export and the import planner (preview, matching, duplicates) |
| `sheets.ts`, `secrets.ts` | Google Sheets sync (service-account sign-in, queue, retries) and secret storage |
| `maintenance.ts`, `seeding.ts` | Trash clean-up and starter lists |

### 3. Storage
- **One encrypted database per account** (`acct_<id>`), plus an encrypted registry of accounts. SQLCipher via `@capacitor-community/sqlite`.
- The database key is random, created on first run and kept in the **Android Keystore**. It is *not* derived from the password, so the password protects access to the screens, not the key.
- Passwords and recovery codes are stored only as salted PBKDF2-SHA256 hashes (600,000 rounds for passwords). Unknown usernames take the same time as known ones. Repeated failures cause a persistent, growing lock-out.

### 4. Online mode (Google Sheets)
- Database triggers add every insert, update and delete to an outbox table, but only when the account is in Online mode with a sheet connected.
- On app open, resume, network return and every few minutes, the app signs in to Google with the service-account key (RS256 JWT) and sends the queued changes in batches. If there is no internet, the queue is left alone, with no penalty, and sent next time.
- A revision counter stops changes made during a sync from being lost. A full re-sync rewrites the sheet.
- Cell values that could be read as formulas are prefixed so a malicious description can't run in the sheet.

### 5. Backup and restore
A backup is a zip with `manifest.json` containing everything. The zip is encrypted with a key derived from the backup password (PBKDF2, at least 100,000 rounds, with a hard upper limit checked before any work is done) and AES-256-GCM, with the header authenticated. Restore validates every field, then writes in a single transaction (all or nothing).

### 6. Android layer: `android-overlay/`
The `android/` project is generated in the build with `npx cap add android`, then `android-overlay/apply.py` adds our parts:

- `BiometricVaultPlugin.java`: stores a secret encrypted with a Keystore key that needs a fingerprint or face check for every use, and is invalidated if fingerprints change.
- `MainActivity.java`: keeps the app inside the status bar, camera cut-out, navigation bar and keyboard; blocks screenshots in release builds.
- `AndroidManifest.xml`: internet and biometric permissions only; no Android backup; no plain-HTTP traffic; no exported components except the launcher.
- `proguard-rules.pro`: shrinking and obfuscation for release builds.

## Building

Nothing runs automatically. On GitHub: **Actions → android → Run workflow**.

1. **web**: logic tests, type-check, web build.
2. **test-apk**: builds a debug APK and publishes it as the **Test build** release. Debug builds use a throw-away key and are marked debuggable, so Google may flag them.
3. **signed-release** (when "sign" is ticked): builds a minified release APK, signs it with your key, verifies the signature and that it is not debuggable, and publishes `v1.0.<run number>`.

Local build: Node 22, JDK 21, Android SDK, then `npm install`, `npx next build`, `npx cap add android`, `python3 android-overlay/apply.py`, `npx cap sync android`, `cd android && ./gradlew assembleDebug`.

### Signing key (one time)
1. Make a key with `keytool -genkeypair -keystore release.keystore -alias dailyexpenses -keyalg RSA -keysize 4096 -validity 10000`.
2. Encode it: `base64 -w0 release.keystore`.
3. In the repo, Settings → Secrets and variables → Actions, add `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS` and `KEY_PASSWORD`.

Keep the key file and passwords safe. Without them the app can never be updated. Signing makes the APK a trustworthy release, but Android still shows an "unknown developer" notice for apps installed outside the Play Store.

## Security summary
Encrypted database; Keystore-held key; hashed passwords with lock-out; biometric with Keystore binding; no cloud backup; no plain HTTP; minimal permissions; strict validation of backups and CSV files; parameterised queries only; spreadsheet formula protection; no analytics or ad code. Automated tests cover the logic layer. No independent security audit has been done, and no software can be promised to have zero vulnerabilities.

## Known limits
- Phones with a very old system WebView (Android 6–7) may need a WebView update.
- Testing so far: unit tests, one Android 14 emulator run and hand testing on real phones.
- If a write happens while another database transaction is open, it joins that transaction.
