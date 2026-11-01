# Daily Expenses

A private expense and income tracker for Android. Everything stays on your phone: no server, no online account, no email, no ads, no tracking. Package `com.dailyexpenses.app`, Android 6.0 and newer.

## How the app works

**Accounts.** You create one or more local accounts on the phone (username + password). Each account has its own database with its own entries, lists, templates, colour palette and settings. A one-time recovery code lets you reset a forgotten password.

**Storage.** Each account's data is saved in an encrypted SQLite database (SQLCipher). The encryption key is generated on the phone and kept in the Android Keystore. Amounts are stored as whole minor units, so there are no rounding errors.

**Offline and Online mode.** Both modes use only the local account and work without internet. In Online mode the app also writes all your data to a Google Sheet you choose, using a Google service account key you provide. Changes made without internet are queued on the phone and sent automatically the next time the app opens with internet. An Offline account can be converted to Online in Settings.

**Backup and restore.** Settings → Data creates a `.zip` containing `manifest.json` with everything (entries, lists, templates, settings, palette, mode, service-account key, account), encrypted with a backup password you choose (AES-256-GCM). Restoring it on a new phone rebuilds the app exactly. Biometric sign-in is not carried over and is turned on again after restoring.

**CSV.** Export all entries to CSV, or import income and expense CSVs. Import shows a preview first, matches names to your existing categories, banks and payment modes, and creates new ones when they don't exist. Nothing is saved until you confirm, and a failed import changes nothing.

**Sign-in and security.** Passwords and recovery codes are stored only as salted PBKDF2 hashes. Repeated wrong passwords trigger a growing lock-out. Optional fingerprint or face sign-in uses a Keystore key that needs a biometric check every time. The app locks itself after the time you choose. Release builds block screenshots and hide the app in the recent-apps view, disallow Android cloud backup and plain-HTTP traffic, and ask for only the internet and biometric permissions.

**Design.** The screens, Material 3 styling and animations are the same as the original web app, packaged inside an Android app (Next.js static export + Capacitor). The original web app is untouched.

## Layout of this repo

| Path | What it is |
| --- | --- |
| `app/`, `components/`, `lib/` | The user interface and app glue |
| `core/` | Logic with tests: database layer, backup, CSV, Sheets sync, accounts and sign-in |
| `android-overlay/` | Native Android parts: biometric plugin, hardened manifest, screen-edge handling |
| `.github/workflows/` | Manual build workflows |

See **SETUP.md** for installing, building and signing.
