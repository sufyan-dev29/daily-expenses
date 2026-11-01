# Daily Expenses

Track what you spend and earn, privately. Your data lives only on your phone, encrypted. There is no account on any server, no email, no ads and no tracking.

Works on Android 6.0 and newer.

---

## Install

1. On GitHub, open **Releases** and download the newest `DailyExpenses.apk` to your phone.
2. Open the file. If Android asks, allow installs from your browser or file manager.
3. If Google Play Protect shows a notice, tap **More details → Install anyway**. Apps installed outside the Play Store always show this.

## Get started

1. Open the app and tap **New account**. Choose a username and a password of at least 10 characters.
2. **Write down your recovery code.** It is shown once and is the only way to reset a forgotten password.
3. Tick "I have saved my recovery code" and continue.

> **Important:** if you lose your password, your recovery code and every backup, nobody can recover your data, not even the developer.

Several people can share one phone. Each account is completely separate, with its own entries, lists, templates, colours and settings.

## Add an expense or income

- Open the **Expense** or **Income** tab.
- Tap the big amount card, enter the amount, then add what it was for.
- Pick the bank, payment mode, date and category (for expenses also **Need** or **Want**).
- Tap **Add Expense** / **Add Income**.
- Use **Save as template** for things you repeat, and the history button (top right) to reuse a past entry.
- Deleted entries go to the **Trash** (top right) and can be restored. They are removed for good after a while.

## See where your money goes

Open **Insights** for totals, trends and breakdowns by category, bank and payment mode. Change the date range or compare with the previous period.

## Settings

| Section | What you can do |
| --- | --- |
| **Appearance** | Pick a colour palette and light or dark mode |
| **Lists** | Add, rename or hide categories, income sources, banks and payment modes |
| **Templates** | Manage saved templates |
| **Formats and behaviour** | Currency, date format, time zone, first day of the week, what the app remembers |
| **Offline / Online** | Choose how the account works (see below) |
| **Data** | Backup, restore, CSV import and export |
| **Security** | Fingerprint or face sign-in, auto-lock, change password, new recovery code |
| **Account** | Sign out or delete the account |

## Offline and Online mode

- **Offline** (default): everything stays on the phone. Works without internet.
- **Online**: the same, plus the app keeps a **Google Sheet** up to date with all your data. If you add entries without internet, they are sent automatically the next time you open the app with internet.

To turn on Online mode:

1. Create a Google Cloud *service account* and download its JSON key.
2. Make a Google Sheet and share it with the service account's email address as **Editor**.
3. In the app: **Settings → Offline / Online → Convert to Online account**, then paste or choose the JSON key, paste the sheet link and tap **Connect**.

You can switch back to Offline or disconnect at any time. Your data stays on the phone either way.

## Back up and move to a new phone

1. **Settings → Data → Back up to a file.** Choose a backup password (at least 8 characters). The app makes an encrypted `.zip` that you can save anywhere (Drive, email to yourself, a computer).
2. On the new phone, install the app and tap **Restore from a backup** on the first screen. Pick the file, enter the backup password, and choose your username and a new password.

Everything comes back exactly as it was: entries, lists, templates, settings, colours, mode and the Google key. Fingerprint sign-in is not copied; turn it on again in Settings → Security.

**Keep the backup password safe. A backup cannot be opened without it.**

You can also restore a backup *inside* an existing account (Settings → Data → Restore from a backup) and choose to **add missing items** or **replace everything**.

## Import and export CSV

- **Export:** Settings → Data → **Export all as CSV**.
- **Import:** Settings → Data → **Import from CSV**. Pick income or expense (or Auto), and the date order. You'll see a preview of what will be added, which categories, banks and payment modes already exist, which new ones will be created, and any rows with problems. Nothing is saved until you tap **Import**, and if something fails nothing is changed.

## Keep it secure

- Turn on **fingerprint or face sign-in** in Settings → Security.
- Set **Lock after** to how soon the app should lock when you leave it.
- Change your password any time. Make a **new recovery code** if you think the old one was seen.

## Problems?

- **Forgot password:** tap **Forgot password?** on the sign-in screen and enter your recovery code.
- **Too many wrong passwords:** the app makes you wait, and the wait grows with each try.
- **Fingerprint stopped working:** if you changed your fingerprints on the phone, sign in with your password and turn it on again.
- **Google Sheet not updating:** Settings → Offline / Online shows the status. Check the sheet is shared with the service account as Editor, then tap **Sync now**.

---

Curious how it's built? See [HOW_IT_IS_BUILT.md](HOW_IT_IS_BUILT.md).
