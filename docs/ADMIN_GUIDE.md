# Stock Audit – Administrator Guide

For the SJBJ & Associates office team who plan audits, review them and send reports.

**Live app:** https://tj-stock-audit.sjbjtractor.workers.dev
Use a laptop for admin work. Menu items are on the left (on a phone: **Menu**).

---

## Weekly routine at a glance
0. **Weekly plan** – the planner plans next week (date → centre → auditor); you check it, **Approve & lock week**, and send the plan Excel to the client.
1. **Upload stock** – each day, upload the client's stock statement for that day's centres; auditors are filled in from the plan.
2. **Live map / Dashboard** – watch check-ins and progress during the day.
3. **Audits** – review each submitted audit: approve, or send back with a note.
4. **Weekly reports** – download the combined report and send it to the client.
5. **Monthly visits** – at month end, export approved visits per auditor.

---

## Dashboard
Today's centres, audits completed, auditors on site now, and audits **waiting for your review**.

## Weekly plan
- The **planner** login (People → Add person → Planner) plans each week: add centres to each day and choose the auditor. Warnings show centres planned twice, centres closed on that weekday, auditors with more than 2 centres a day and centres without an auditor.
- The planner sees whether each planned visit is assigned / in progress / submitted / approved – but never photos, reports, people, tracking or monthly visits.
- **Approve & lock week** when it is final (the planner can no longer change it; **Unlock week** if needed). **Download plan (Excel)** to send to the client.

## Upload stock
1. Choose the client's Excel (one sheet per centre: Registration No, engineNumber, chassisNumber) and the **audit date**.
2. Each sheet is matched to a centre. If a sheet name is unknown (e.g. "Badnagar"), choose **Same as existing centre: …** (tick **Remember this** so it is matched automatically next time) or **Add as a new centre**.
3. Auditors are filled in from the weekly plan ("✓ from the weekly plan"); you can still change them. Centres planned for that date but missing from the file are listed at the top. Data issues in a sheet (missing chassis, duplicates, odd registration numbers) are listed under it.
4. **Create N audits**. Auditors see them on their phones immediately.

## Audits
Filter by date, status, centre or auditor. Click a centre to open the audit:
- Counts, visit details, check-in **distance from the centre** (red if outside the allowed radius), the **storefront photo**, the **check-in selfie** (visible to your office only – never shown to the client or included in reports), and a map with the GPS trail between check-in and check-out.
- Every tractor with photos, accessories, the **facility condition** checklist (rating, photos, remarks per area) and signatures.
- **Approve** – the audit becomes visible to the client and counts in Monthly visits.
- **Send back to auditor** – write what needs fixing; it returns to the auditor's phone.
- **Undo approval**, change the **auditor**, or **Delete this audit** (not possible once approved).
- **Excel** / **Download full report** for this centre.

Statuses: Assigned → In progress → Awaiting review → Approved (or Returned to auditor).

**Blind count (how matching works):** auditors never see the stock list or its count. They record every tractor shown (chassis, plate, engine, meter reading, 3 photos) and the app matches by **chassis number**:
- Chassis matches a stock tractor → **Verified**.
- Not in the records → **Extra**. If the plate belongs to a stock tractor but the chassis is different, it counts as **short + extra** and is flagged ("Plate … is in records with a different chassis").
- A chassis that looks like a stock one (typo?) must be typed twice; if the auditor confirms it, it becomes an extra flagged "Chassis close to …" – check the chassis photo.
- After **Done counting** the auditor only sees *how many* are not shown. Off-site places (yard, service centre) are checked in with GPS and a photo and shown with their distance from the centre. Everything closes the same day; whatever was not shown is **Short**, with the manager's explanation. The **first count** (before any off-site visits) is kept as evidence.

**Reviewing differences:** for every short tractor, check the manager's explanation and the **Supporting documents** (invoice, challan, gate pass, job card, transfer note) shown in the audit. A document explains the reason but is not physical proof – the tractor stays **Short** in the report. Extras flagged "chassis close to…" or "plate … in records with a different chassis" need a look at the chassis photo before you approve. If something does not add up, **Send back to auditor** with a note, or approve and raise it with the client.

**Meter readings:** each tractor's meter (KM or hours) is recorded weekly. The audit and reports show the previous reading, the difference, and a red flag when it moved by more than 1 or went down. The first reading for a tractor is its starting point.

**Manager's declaration:** the manager signs an on-screen declaration (count, other places, number not shown) – no printout needed – and can be sent a copy on WhatsApp.

**Centre closed / not carried out:** if the auditor reports that the audit could not be done, the audit shows a red "Audit not carried out" banner with the reason, storefront photo and GPS. Approve it (it appears in reports as not carried out) or send it back so the audit is done. In Monthly visits these are counted in a separate **Centre closed** column, so you decide how to bill them.

## Alerts
Shown under 🔔 and, on the Android app, as phone notifications:
- **Late** – an auditor not checked in 30 minutes after the line's reach-by time (also listed on the Dashboard).
- **Check-in far from the centre** – outside the centre's allowed radius.
- **Audit with findings** – straight away when an audit is submitted with short tractors, chassis to check or meter flags.
- **Audit not carried out** – the auditor reported the centre closed.
- **6 PM summary** – how many audits are waiting for your approval.

Auditors are told their allocation when you **Approve & lock** the week (and if you change a line afterwards). Reminders go out at 7 PM the day before and in the morning. Phone alerts need the Firebase key saved in Cloudflare as the secret `FCM_SERVICE_ACCOUNT`; without it alerts still appear under 🔔.

## Live map
Auditors currently checked in, their last location, distance from the centre and progress. Refreshes every minute. "No update in 30 min" means the phone stopped sending location (screen locked on iPhone, phone off, or no signal).

## Weekly reports
Choose the period (**This week** / **Last week**), untick any audits to leave out, then **Download combined report**. This is the client's weekly deliverable: consolidated Excel + each centre's Excel, photo PDF and photos named by registration number. Reports carry the Tractor Junction logo (top left) and the SJBJ logo (top right).

## Monthly visits
Pick the month. Shows approved visits, days worked and hours on site per auditor; click a name for each visit. **Download Excel** gives a summary sheet and a visit-by-visit sheet. Only **approved** audits are counted – review everything awaiting review before closing the month.

## Centres
- Edit a centre: address, **exact location** (paste coordinates such as `23.800827, 79.454768` into Latitude), allowed radius, outlet manager and mobile, opening hours, weekly off, and **other names** used in stock statements.
- A centre with no location gets one automatically from the first auditor check-in – check it on the map afterwards.
- **Download details template** → send to the client → **Import centre details** to update all centres at once. Google Maps links and coordinates are read automatically; empty cells never erase saved details; unknown names are only added if you tick them.

## People
- **Auditors and planners:** **Download team template** → collect name, mobile, location, role (Auditor / Planner) and optionally a password → **Import team**. Each person gets a username (first name + last 4 digits of mobile) and the password from the sheet, or a generated one. **Save the login details immediately** (Excel download, or **Copy message** to send on WhatsApp) – passwords are shown only once.
- **Add person** for a single auditor, a client login or another administrator.
- **Edit** to reset a password or **untick Active** when someone leaves (they are signed out at once; their past audits stay).

## Good to know
- Auditors take a selfie at the centre at each check-in (your office only). A storefront photo and a completed facility condition checklist (6 standard areas; photo for each unless N/A; remark for Poor or N/A) are required for every visit. The weekly summary shows how many areas were rated Poor per centre. Storefront, tractor, chassis and accessory photos can only be taken live in the app.
- Changes to the app reach everyone automatically; auditors get them the next time they open the app.
- iPhone auditors: location is recorded only while the app is open on screen; GPS is still on check-in, every photo and check-out.
- Photo storage: about 10 GB free (roughly two years). Archive old weekly reports before then.
