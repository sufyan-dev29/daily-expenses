# Daily Expenses – setup guide

Daily Expenses is a standalone Android app (package `com.dailyexpenses.app`, Android 6.0+). Everything lives on the phone: no server, no online account, no email. The web app it came from (`sufyan-dev29/expense-tracker`) is not changed by this repo.

## 1. Install a build

**Signed release (recommended):** Releases → the newest `v1.0.x`, file `DailyExpenses.apk` (see section 6 to create it).

**Test build:** Releases → "Test build", file `DailyExpenses-test.apk`. It uses a debug key and has debugging switched on, so use it only for testing; Google may flag it.

1. Download the APK on the phone (or copy it over from a computer).
2. Open it and allow "Install unknown apps" for your browser or file manager when asked.
3. Open Daily Expenses and create an account.

Android may show a Play Protect warning for apps installed outside the Play Store. A signed release reduces this but cannot remove it for sideloaded apps.

## 2. First use

- **Create an account** (username + password of at least 10 characters). It exists only on this phone. Each account has its own entries, lists, templates, palette and settings.
- **Save your recovery code.** It is shown once. It is the only way to reset a forgotten password.
- **If you lose your password, your recovery code and every backup, your data cannot be recovered by anyone.**
- **Offline / Online** is chosen on the sign-in screen. Both use a local account. Online mode also keeps a Google Sheet up to date (see below).

## 3. Features

| Area | What it does |
| --- | --- |
| Entries | Expenses and income with categories, banks, payment modes, templates, trash and restore |
| Insights | Same charts and summaries as the web app |
| Google Sheet (Online mode) | A Google service account writes all your data to a sheet. Changes made without internet are queued and sent automatically the next time the app opens with internet. Settings → "Convert to Online account" turns it on for an Offline account |
| Backup | Settings → Data → Back up. Creates a `.zip` with `manifest.json` (entries, lists, templates, settings, palette, mode, service-account key), encrypted with a backup password (AES-256-GCM) |
| Restore | On the sign-in screen ("Restore from backup") to rebuild the app on a new phone, or inside Settings to merge or replace |
| CSV import | Settings → Data → Import. Shows a preview first. Matches names to your existing categories, banks and payment modes and creates new ones when missing |
| CSV export | Settings → Data → Export |
| Biometric sign-in | Settings → Security. Uses the phone's fingerprint or face. It is not included in backups; turn it on again after restoring |
| Auto-lock | Settings → Security → Lock after |

### Connecting a Google Sheet
1. Create a Google Cloud service account and download its JSON key.
2. Create a Google Sheet and share it with the service account's email as **Editor**.
3. In the app: Settings → Online → paste or choose the JSON key, paste the sheet link, then Connect.

## 4. Security notes (please read)

- The database is encrypted with SQLCipher. Its key is generated on the phone and held in the Android Keystore. **It is not derived from your password**, so your password protects access to the app's screens, not the key itself.
- Passwords and recovery codes are stored only as salted PBKDF2 hashes. Repeated wrong passwords trigger an increasing lock-out.
- The app has no ad or analytics code, does not allow Android cloud backup, blocks plain-HTTP traffic and hides its screen in the recent-apps view on release builds.
- The only network use is the optional Google Sheet sync.
- No software can be guaranteed to have zero vulnerabilities. The project runs automated tests on every build, but it has not had an independent security audit.

## 5. Building

Nothing builds automatically. Go to **Actions → android → Run workflow** on GitHub.

- **Run with "sign" off:** runs the logic tests, type-check and web build, then builds a test APK and publishes it under **Releases → "Test build"**.
- **Run with "sign" on:** also builds the signed release APK and publishes it as a new release (`v1.0.<run number>`). It needs the signing secrets from section 6, and fails with a clear message if they are missing.

Logic tests only (Node 22+, no install needed):

```
node --experimental-strip-types --no-warnings --test core/*.test.ts
```

## 6. Signed release and Google Play Protect

**Why Google flags the test build.** Play Protect warns about apps from unknown developers. The test APK is made worse by two things: it is signed with a throw-away debug key and it is marked debuggable. Use the signed release instead.

**Steps (once, on your own computer).** The key never goes into the repo and I never see it.

1. Make the key. Keep the file and both passwords somewhere safe; without them you can never update the app.
   `keytool -genkeypair -v -keystore release.keystore -alias dailyexpenses -keyalg RSA -keysize 4096 -validity 10000`
2. Encode it: `base64 -w0 release.keystore` (macOS: `base64 -i release.keystore`) and copy the output.
3. In the repo: Settings → Secrets and variables → Actions → New repository secret. Add:
   - `KEYSTORE_BASE64` (the encoded text)
   - `KEYSTORE_PASSWORD`
   - `KEY_ALIAS` (`dailyexpenses` if you used the command above)
   - `KEY_PASSWORD`
4. Run **android** with "sign" on and install `DailyExpenses.apk` from the new release.

**What to expect.** A properly signed, non-debuggable release with minimal permissions gets far fewer warnings and should not be called "harmful". Android can still show an "unrecognised app / unknown developer" notice for any app installed outside the Play Store, and signing cannot remove that. On that screen choose **More details → Install anyway**. If you want no warning at all, the app would need to be published through Google Play.

## 7. Known limits

- Very old phones (Android 6–7) may ship an outdated system WebView; the app needs a reasonably recent one. Android 8 and newer should be fine once WebView is updated.
- Testing so far: the logic tests, plus one Android 14 emulator run. Everything else is tested by hand on real phones.
