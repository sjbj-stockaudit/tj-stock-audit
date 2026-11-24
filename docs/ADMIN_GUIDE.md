# Stock Audit – Administrator Guide

For the SJBJ & Associates office team who plan audits, review them and send reports.

**Live app:** https://tj-stock-audit.sjbjtractor.workers.dev
Use a laptop for admin work. Menu items are on the left (on a phone: **Menu**).

---

## Weekly routine at a glance
1. **Upload stock** – upload the client's stock statement and assign auditors.
2. **Live map / Dashboard** – watch check-ins and progress during the day.
3. **Audits** – review each submitted audit: approve, or send back with a note.
4. **Weekly reports** – download the combined report and send it to the client.
5. **Monthly visits** – at month end, export approved visits per auditor.

---

## Dashboard
Today's centres, audits completed, auditors on site now, and audits **waiting for your review**.

## Upload stock
1. Choose the client's Excel (one sheet per centre: Registration No, engineNumber, chassisNumber) and the **audit date**.
2. Each sheet is matched to a centre. If a sheet name is unknown (e.g. "Badnagar"), choose **Same as existing centre: …** (tick **Remember this** so it is matched automatically next time) or **Add as a new centre**.
3. Assign an auditor to each centre (or **Assign all to**). Data issues in a sheet (missing chassis, duplicates, odd registration numbers) are listed under it.
4. **Create N audits**. Auditors see them on their phones immediately.

## Audits
Filter by date, status, centre or auditor. Click a centre to open the audit:
- Counts, visit details, check-in **distance from the centre** (red if outside the allowed radius), the **storefront photo**, the **check-in selfie**, and a map with the GPS trail between check-in and check-out.
- Every tractor with photos, accessories, the **facility condition** checklist (rating, photos, remarks per area) and signatures.
- **Approve** – the audit becomes visible to the client and counts in Monthly visits.
- **Send back to auditor** – write what needs fixing; it returns to the auditor's phone.
- **Undo approval**, change the **auditor**, or **Delete this audit** (not possible once approved).
- **Excel** / **Download full report** for this centre.

Statuses: Assigned → In progress → Awaiting review → Approved (or Returned to auditor).

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
- **Auditors:** **Download auditor template** → collect details → **Import auditors**. Each person gets a username (first name + last 4 digits of mobile) and a starting password. **Save the login details immediately** (Excel download, or **Copy message** to send on WhatsApp) – starting passwords are shown only once.
- **Add person** for a single auditor, a client login or another administrator.
- **Edit** to reset a password or **untick Active** when someone leaves (they are signed out at once; their past audits stay).
- **Sign-in selfies** shows every daily sign-in selfie of an auditor.

## Good to know
- Auditors sign in with a selfie every day and take a selfie at each check-in. A storefront photo and a completed facility condition checklist (6 standard areas; photo for each unless N/A; remark for Poor or N/A) are required for every visit. The weekly summary shows how many areas were rated Poor per centre. Storefront, tractor, chassis and accessory photos can only be taken live in the app.
- Changes to the app reach everyone automatically; auditors get them the next time they open the app.
- iPhone auditors: location is recorded only while the app is open on screen; GPS is still on check-in, every photo and check-out.
- The **practice copy** (orange banner) is separate – nothing there affects the live app.
- Photo storage: about 10 GB free (roughly two years). Archive old weekly reports before then.
