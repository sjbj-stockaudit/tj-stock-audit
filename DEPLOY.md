# Putting the app online (free)

Everything runs on Cloudflare's free plan. You need about 20 minutes, once.

## 1. Create a Cloudflare account
1. Sign up at **https://dash.cloudflare.com/sign-up** with the company email.
2. In the left menu open **R2 Object Storage** and click **Purchase R2 / Enable**.
   Cloudflare asks for a card to turn on photo storage. The free allowance is 10 GB of photos
   and you are not charged unless you go over it (about 4–5 GB a year at the current volume).

## 2. Create an API token (lets GitHub publish the app for you)
1. Go to **https://dash.cloudflare.com/profile/api-tokens** → **Create Token** → **Create Custom Token**.
2. Name: `tj-stock-audit deploy`. Add these **Account** permissions, each set to **Edit**:
   - Cloudflare Pages
   - D1
   - Workers R2 Storage
   Also add **Account → Account Settings → Read**.
3. **Continue to summary** → **Create Token** → copy the token.
4. Copy your **Account ID**: on the Cloudflare home page, click your account; it is in the URL
   (`dash.cloudflare.com/<ACCOUNT ID>`) and under *Account details* on the right.

## 3. Give the token to GitHub
In the GitHub repository: **Settings → Secrets and variables → Actions → New repository secret**.
Add two secrets:

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | the token from step 2 |
| `CLOUDFLARE_ACCOUNT_ID` | your account ID |

## 4. Publish
GitHub → **Actions** → **Deploy to Cloudflare** → **Run workflow**. After 2–3 minutes it is live at
**https://tj-stock-audit.pages.dev**. Every later change merged into `main` publishes automatically.

## 5. First sign-in
Open the address. The first screen creates the **administrator** account. Then in **People** add
each auditor (with their agency) and a login for Tractor Junction.

## 6. The auditors' Android app
1. GitHub → **Actions** → **Build Android app** → **Run workflow**, enter `https://tj-stock-audit.pages.dev`.
2. When it finishes, download **stock-audit-android** from the bottom of the run and unzip it to get `app-debug.apk`.
3. Send the APK to auditors (WhatsApp / Drive). On the phone: open it → allow *Install unknown apps* once → Install.
4. On first check-in, allow **Location → Allow all the time** and **Notifications**. While an audit is open
   the phone shows "Stock audit in progress"; that is the location tracking, and it stops at check-out.

The app shows the live website, so future improvements reach auditors without reinstalling.
Rebuild the APK only if the address changes. (Each build is signed with a new key, so to install a
rebuilt APK, uninstall the old one first.)

## Free-plan limits (for reference)
| What | Free limit | Expected use |
|---|---|---|
| Website & API requests | 100,000 / day | a few thousand / day |
| Database (D1) | 5 GB | under 1 GB / year |
| Photos (R2) | 10 GB | ~4–5 GB / year |

When photo storage nears 10 GB, download old weekly reports (they contain all photos) to keep as an
archive, then delete those old audits. Beyond 10 GB, R2 costs about US$0.015 per GB per month.
