# How the app is hosted (free)

Everything runs on Cloudflare's free plan, in the account for the project Gmail.

| Part | Cloudflare service | Name |
|---|---|---|
| Website + API | Workers (connected to this GitHub repository) | `tj-stock-audit` |
| Database | D1 (Asia-Pacific) | `tj-stock-audit` |
| Photos | R2 (Asia-Pacific) | `tj-stock-audit-photos` |

## Updates
Cloudflare watches the production branch of this repository. Every push to it is built and
published automatically (Workers & Pages → tj-stock-audit → Deployments shows each build).

## Database changes
When a new file is added to `migrations/`, apply it once with:
```bash
CLOUDFLARE_ACCOUNT_ID=<account id> npx wrangler d1 migrations apply DB --remote
```

## First sign-in
Open the site. The first screen creates the **administrator** account. Then in **People** add
each auditor (with their agency) and a login for Tractor Junction.

## The auditors' Android app
1. GitHub → **Actions** → **Build Android app** → **Run workflow** (the website address is pre-filled).
2. **First build only:** at the bottom of the finished run, download **SIGNING-KEY-save-to-github-secrets** and follow
   the README inside: add `ANDROID_KEYSTORE_B64` and `ANDROID_KEYSTORE_PASSWORD` under Settings → Secrets and variables →
   Actions. Keep a copy of both files safe. Every later build uses this key, so updates install over the old app.
3. Download **stock-audit-android**, unzip it to get `app-release.apk`, and send it to auditors (WhatsApp / Drive).
4. On the phone: open it → allow *Install unknown apps* once → Install. Allow camera, location and notifications.
   The first time an audit is opened, the app shows a one-time "Open app settings" tip for battery saver.

The app shows the live website, so improvements reach auditors without reinstalling. Rebuild the APK only
for changes to the app itself (icon, permissions, address). The version number rises with every build.

## Free-plan limits
| What | Free limit | Expected use |
|---|---|---|
| Requests | 100,000 / day | a few thousand / day |
| Database (D1) | 5 GB | under 1 GB / year |
| Photos (R2) | 10 GB | ~4–5 GB / year |

When photo storage nears 10 GB, download old weekly reports (they contain all photos) as an
archive, then delete those old audits. Beyond 10 GB, R2 costs about US$0.015 per GB per month.
