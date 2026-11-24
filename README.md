# Stock Audit

Field stock-verification app for Tractor Junction outlet audits by M/s SJBJ & Associates.

- **Auditors (Android phone):** see assigned centres, get directions, check in with GPS, check every
  tractor against the client's stock list with chassis/tractor photos (GPS + time stamped on the photo),
  record extra tractors and accessories with photos, capture auditor and outlet-manager signatures,
  submit and check out. Location is recorded between check-in and check-out.
- **Administrator:** upload the client's stock statement (one sheet per centre), assign auditors,
  live map, review and approve audits, per-centre and weekly consolidated reports, centres, people,
  monthly billing export (approved centre visits per auditor).
- **Client (Tractor Junction):** read-only access to approved audits, photos and report downloads.

Reports follow the client's deliverables: Excel per centre in the agreed format (Verified /
Chassis Number Mismatch / Not Found / Extra), a PDF of photos captioned by registration number,
individual photos named by registration number, and one consolidated Excel for the week.

## Stack (free tier)
Cloudflare Workers with static assets (React + Vite UI, Hono API), D1 (SQLite) database,
R2 photo storage, Capacitor Android wrapper with background geolocation. Reports are generated
in the browser (ExcelJS, jsPDF, JSZip) to stay within the free plan's server limits.

## User guides
| For | Guide |
|---|---|
| Office administrators | [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) · [PDF](docs/Stock_Audit_Admin_Guide.pdf) |
| Auditors (Android & iPhone) | [docs/AUDITOR_GUIDE.md](docs/AUDITOR_GUIDE.md) · [PDF](docs/Stock_Audit_Auditor_Guide.pdf) |
| Client – Tractor Junction (laptop, Android & iPhone) | [docs/CLIENT_GUIDE.md](docs/CLIENT_GUIDE.md) · [PDF](docs/Stock_Audit_Client_Guide_Tractor_Junction.pdf) |

## Going live
See **[DEPLOY.md](DEPLOY.md)**.

## Local development
```bash
npm install
npm run db:migrate:local
npm run preview          # builds and serves on http://localhost:8788
```

## Layout
| Path | What |
|---|---|
| `server/` | API (auth, centres, uploads, visits, photos, review, live, billing) |
| `server/worker.ts` | Cloudflare Worker entry |
| `migrations/` | Database schema and the MP centre list |
| `shared/domain.ts` | Matching rules shared by server and app (chassis comparison, names) |
| `src/pages/auditor/` | Phone screens |
| `src/pages/admin/`, `src/pages/` | Office and client screens |
| `src/lib/reports.ts` | Excel / PDF / zip report generation |
| `android/` | Android app wrapper |
