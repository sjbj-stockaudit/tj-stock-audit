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
1. GitHub → **Actions** → **Build Android app** → **Run workflow**, enter the site address.
2. When it finishes, download **stock-audit-android** from the bottom of the run and unzip it to get `app-debug.apk`.
3. Send the APK to auditors (WhatsApp / Drive). On the phone: open it → allow *Install unknown apps* once → Install.
4. On first check-in, allow **Location → Allow all the time** and **Notifications**. While an audit is open
   the phone shows "Stock audit in progress"; that is the location tracking, and it stops at check-out.

The app shows the live website, so improvements reach auditors without reinstalling.
Rebuild the APK only if the address changes. (Each build is signed with a new key, so to install a
rebuilt APK, uninstall the old one first.)

## Free-plan limits
| What | Free limit | Expected use |
|---|---|---|
| Requests | 100,000 / day | a few thousand / day |
| Database (D1) | 5 GB | under 1 GB / year |
| Photos (R2) | 10 GB | ~4–5 GB / year |

When photo storage nears 10 GB, download old weekly reports (they contain all photos) as an
archive, then delete those old audits. Beyond 10 GB, R2 costs about US$0.015 per GB per month.
