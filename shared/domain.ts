// Logic shared by the server (Cloudflare Functions) and the browser app.

export type Role = 'admin' | 'auditor' | 'client' | 'planner';
export type VisitStatus = 'assigned' | 'in_progress' | 'submitted' | 'approved' | 'returned';
export type TractorStatus = 'pending' | 'verified' | 'mismatch' | 'not_found' | 'extra';
export type PhotoKind = 'chassis' | 'tractor' | 'accessory' | 'storefront' | 'signature' | 'other';

/** Wording used in the client's report format. */
export const TRACTOR_STATUS_LABEL: Record<TractorStatus, string> = {
  pending: 'Pending',
  verified: 'Verified',
  mismatch: 'Chassis Number Mismatch',
  not_found: 'Not Found',
  extra: 'Extra – Not in Inventory',
};

export const VISIT_STATUS_LABEL: Record<VisitStatus, string> = {
  assigned: 'Assigned',
  in_progress: 'In progress',
  submitted: 'Awaiting review',
  approved: 'Approved',
  returned: 'Returned to auditor',
};

/** Centre-name key used to match stock-sheet tab names to centres ("Ashok Nagar" == "ASHOKNAGAR"). */
export function centreKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Canonical form of a chassis / registration / engine number.
 * Excel stores some chassis numbers as plain numbers, people type spaces and dashes,
 * so compare on upper-case letters and digits only.
 */
export function idKey(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Treat letters that look like digits as digits (O/0, I/1, S/5, B/8, Z/2) to spot likely typos. */
function lookalikeKey(value: string): string {
  return idKey(value).replace(/O/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

export type ChassisComparison = 'match' | 'near' | 'different' | 'empty';

/** Compare the chassis number the auditor saw against the client's record. */
export function compareChassis(expected: unknown, seen: unknown): ChassisComparison {
  const e = idKey(expected);
  const s = idKey(seen);
  if (!s) return 'empty';
  if (e === s) return 'match';
  if (!e) return 'different';
  if (lookalikeKey(e) === lookalikeKey(s) || editDistance(e, s) <= 2) return 'near';
  return 'different';
}

/** Great-circle distance in metres. */
export function distanceMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Convert an Excel cell value to clean text without scientific notation. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isInteger(value) ? BigInt(value).toString() : String(value);
  if (typeof value === 'object') {
    const v = value as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (v.richText) return v.richText.map((r) => r.text).join('').trim();
    if (v.text !== undefined) return String(v.text).trim();
    if (v.result !== undefined) return cellText(v.result);
  }
  return String(value).trim();
}

/** True if the point is inside India (rough bounding box), to catch swapped or mistyped numbers. */
export function inIndia(lat: number, lng: number): boolean {
  return lat >= 6 && lat <= 37.5 && lng >= 68 && lng <= 97.5;
}

/**
 * Read coordinates from what people paste: "23.8008, 79.4547", or a full Google Maps link
 * (…/@23.80,79.45,17z…, …!3d23.80!4d79.45…, ?q=23.80,79.45, ?ll=…, destination=…).
 * Short links (maps.app.goo.gl/…) carry no coordinates and must be expanded first.
 */
export function parseCoords(text: string): { lat: number; lng: number } | null {
  if (!text) return null;
  let t = String(text).trim();
  try {
    t = decodeURIComponent(t);
  } catch {
    /* keep as is */
  }
  const num = '(-?\\d{1,3}\\.\\d+)';
  const patterns = [
    new RegExp(`!3d${num}!4d${num}`), // exact pin position inside place links
    new RegExp(`[?&](?:q|query|ll|destination|daddr|center)=${num}\\s*,\\s*${num}`),
    new RegExp(`@${num},${num}`),
    new RegExp(`^${num}\\s*[,\\s]\\s*${num}$`),
    new RegExp(`${num}°?\\s*N?\\s*,\\s*${num}°?\\s*E?`),
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (inIndia(lat, lng)) return { lat, lng };
      if (inIndia(lng, lat)) return { lat: lng, lng: lat }; // swapped
    }
  }
  return null;
}

export const isShortMapsLink = (text: string) => /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\//i.test(String(text).trim());

// ------------------------------------------------------------------ facility condition

export type FacilityRating = 'good' | 'average' | 'poor' | 'na';
export const FACILITY_RATING_LABEL: Record<FacilityRating, string> = { good: 'Good', average: 'Average', poor: 'Poor', na: 'Not applicable' };

/** Areas every audit checks; auditors can add more for a particular centre. */
export const DEFAULT_FACILITY_AREAS = [
  'Showroom display area',
  'Tractor yard / parking',
  'Accessories & spares racks',
  'Battery storage',
  'Tyre storage',
  'Overall cleanliness & safety (e.g. fire extinguisher)',
];

/** What is still missing for one checklist row, or null if complete. */
export function facilityProblem(row: { rating: string | null; remarks: string | null }, photoCount: number): string | null {
  if (!row.rating) return 'condition not rated';
  if (row.rating !== 'na' && photoCount === 0) return 'photo missing';
  if ((row.rating === 'poor' || row.rating === 'na') && !row.remarks?.trim()) return 'remark needed';
  return null;
}

/** Movement allowed between two weekly meter readings before it is flagged (1 km or 1 hour). */
export const METER_TOLERANCE = 1;
export type MeterFlag = 'moved' | 'went_down' | 'unit_changed' | null;

/** Compare this week's meter reading with the last one recorded for the same chassis. */
export function meterCheck(
  prev: number | null | undefined,
  prevUnit: string | null | undefined,
  cur: number | null | undefined,
  curUnit: string | null | undefined,
): { diff: number | null; flag: MeterFlag } {
  if (prev == null || cur == null) return { diff: null, flag: null };
  if ((prevUnit ?? 'km') !== (curUnit ?? 'km')) return { diff: null, flag: 'unit_changed' };
  const diff = Math.round((cur - prev) * 10) / 10;
  return { diff, flag: diff < 0 ? 'went_down' : diff > METER_TOLERANCE ? 'moved' : null };
}

export const METER_FLAG_LABEL: Record<Exclude<MeterFlag, null>, string> = {
  moved: 'Used / moved since last audit',
  went_down: 'Reading lower than last audit',
  unit_changed: 'Different meter unit from last audit',
};
