import { useSyncExternalStore } from 'react';

/**
 * English / Hindi for the auditor's screens (and sign-in). Office, client and planner screens
 * stay in English. Photo stamps and reports are always English (they go to the client).
 * Keys are the English text itself; {name} marks a value filled in at run time.
 */
export type Lang = 'en' | 'hi';
const KEY = 'tj_lang';

let lang: Lang = (() => {
  try {
    return localStorage.getItem(KEY) === 'hi' ? 'hi' : 'en';
  } catch {
    return 'en';
  }
})();
let officeMode = false; // true for admin / client / planner: always English
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setLang(l: Lang) {
  lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* ignore */
  }
  emit();
}
export function setOfficeMode(on: boolean) {
  if (officeMode !== on) {
    officeMode = on;
    emit();
  }
}
export const currentLang = (): Lang => (officeMode ? 'en' : lang);
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

const HI: Record<string, string> = {
  // sign-in, header, account
  'Sign in': 'साइन इन',
  Username: 'यूज़रनेम',
  Password: 'पासवर्ड',
  'Forgot your password? Ask your administrator to reset it.': 'पासवर्ड भूल गए? ऑफ़िस से रीसेट करवाएँ।',
  'Wrong username or password.': 'यूज़रनेम या पासवर्ड गलत है।',
  'Sign out': 'साइन आउट',
  'My account': 'मेरा अकाउंट',
  'Current password': 'मौजूदा पासवर्ड',
  'New password': 'नया पासवर्ड',
  'At least 8 characters': 'कम से कम 8 अक्षर',
  'Password changed.': 'पासवर्ड बदल गया।',
  'Change password': 'पासवर्ड बदलें',
  'Your current password is wrong.': 'मौजूदा पासवर्ड गलत है।',
  'The new password must be at least 8 characters.': 'नया पासवर्ड कम से कम 8 अक्षर का होना चाहिए।',
  'Loading…': 'लोड हो रहा है…',

  // home
  'Namaste, {name}': 'नमस्ते, {name}',
  'Checked in now': 'अभी चेक-इन',
  'Sent back for correction': 'सुधार के लिए वापस',
  'To audit': 'ऑडिट करना है',
  'Coming up': 'आने वाले',
  Submitted: 'जमा किए गए',
  'No centres assigned to you right now.': 'अभी आपको कोई सेंटर नहीं सौंपा गया।',
  '{n} tractors': '{n} ट्रैक्टर',
  '{n} checked': '{n} जाँचे',
  Directions: 'रास्ता',
  'Continue audit': 'ऑडिट जारी रखें',
  'Fix and resubmit': 'सुधारें और दोबारा जमा करें',
  Start: 'शुरू करें',

  // statuses
  Assigned: 'सौंपा गया',
  'In progress': 'चालू',
  'Awaiting review': 'जाँच बाकी',
  Approved: 'स्वीकृत',
  'Returned to auditor': 'सुधार हेतु वापस',
  Pending: 'बाकी',
  Verified: 'सत्यापित',
  Mismatch: 'मेल नहीं',
  'Not Found': 'नहीं मिला',
  Extra: 'अतिरिक्त',

  // audit header & check-in
  '← My centres': '← मेरे सेंटर',
  '{n} tractors in stock list': 'स्टॉक लिस्ट में {n} ट्रैक्टर',
  'Reported: audit not carried out': 'रिपोर्ट भेजी गई: ऑडिट नहीं हो सका',
  'Audit submitted': 'ऑडिट जमा हो गया',
  'Submitted {a}. Checked out {b}.': '{a} को जमा किया। {b} को चेक-आउट।',
  'Back to my centres': 'मेरे सेंटर पर वापस जाएँ',
  'Correction needed:': 'सुधार ज़रूरी:',
  '{a} of {b} checked': '{b} में से {a} जाँचे गए',
  'Location is being recorded until you submit': 'जमा करने तक लोकेशन रिकॉर्ड हो रही है',
  'Stock ({n})': 'स्टॉक ({n})',
  'Extra ({n})': 'अतिरिक्त ({n})',
  'Accessories ({n})': 'एक्सेसरीज़ ({n})',
  Facility: 'सुविधा',
  Finish: 'समाप्त',
  'Take a selfie at the centre to check in.': 'चेक-इन के लिए सेंटर पर सेल्फ़ी लें।',
  'Sent back by the office:': 'ऑफ़िस ने वापस भेजा:',
  'Manager:': 'मैनेजर:',
  'Closed {day}': '{day} को बंद',
  'Open directions in Google Maps': 'Google Maps में रास्ता देखें',
  'Continue the audit': 'ऑडिट जारी रखें',
  'Reached the centre?': 'सेंटर पहुँच गए?',
  'Take a selfie at the centre (with the showroom behind you if possible). ': 'सेंटर पर सेल्फ़ी लें (हो सके तो पीछे शोरूम दिखे)। ',
  'Checking in records your location and time. Your location is recorded until you submit the audit.':
    'चेक-इन से आपकी लोकेशन और समय दर्ज होता है। ऑडिट जमा करने तक आपकी लोकेशन रिकॉर्ड होती रहेगी।',
  "You are {d} from the centre's saved location. If you are at the centre, check in anyway – the office will see the distance.":
    'आप सेंटर की सेव लोकेशन से {d} दूर हैं। अगर आप सेंटर पर ही हैं तो फिर भी चेक-इन करें – ऑफ़िस को दूरी दिखेगी।',
  'Try again': 'फिर से कोशिश करें',
  'Check in anyway': 'फिर भी चेक-इन करें',
  'Check in': 'चेक-इन करें',
  'Check in and fix': 'चेक-इन करके सुधारें',

  // android tip
  'One-time setting: keep location working with the screen off': 'एक बार की सेटिंग: स्क्रीन बंद होने पर भी लोकेशन चालू रखें',
  'Tap "Open app settings"': '"ऐप सेटिंग खोलें" दबाएँ',
  'Battery → choose Unrestricted / No restrictions': 'Battery → Unrestricted / No restrictions चुनें',
  'Permissions → Location → Allow (and Use precise location on)': 'Permissions → Location → Allow (और Use precise location चालू)',
  'Come back to this app': 'इस ऐप पर वापस आएँ',
  'Open app settings': 'ऐप सेटिंग खोलें',
  Done: 'हो गया',

  // storefront
  'Storefront photo *': 'शोरूम के सामने की फोटो *',
  '✓ Taken': '✓ ली गई',
  Required: 'ज़रूरी',
  'Stand outside and take the whole showroom front with the Tractor Junction board visible.':
    'बाहर खड़े होकर पूरे शोरूम की फोटो लें – Tractor Junction का बोर्ड दिखना चाहिए।',
  'Storefront photo': 'शोरूम फोटो',

  // tractor list & sheet
  'Search reg / chassis / engine no.': 'रजि. / चेसिस / इंजन नंबर से खोजें',
  All: 'सभी',
  'To check': 'जाँचना है',
  Checked: 'जाँचे गए',
  Chassis: 'चेसिस',
  'photo missing': 'फोटो बाकी',
  'No tractors match.': 'कोई ट्रैक्टर नहीं मिला।',
  'Take a photo of the chassis number first.': 'पहले चेसिस नंबर की फोटो लें।',
  'Take a photo of the whole tractor.': 'पूरे ट्रैक्टर की फोटो लें।',
  'Type the chassis number you see on the tractor.': 'ट्रैक्टर पर दिख रहा चेसिस नंबर लिखें।',
  'Add a remark explaining the mismatch.': 'मेल न खाने का कारण रिमार्क में लिखें।',
  'Reg. no': 'रजि. नंबर',
  Engine: 'इंजन',
  '1. Photo of the chassis number *': '1. चेसिस नंबर की फोटो *',
  'Chassis photo': 'चेसिस फोटो',
  '2. Photo of the whole tractor *': '2. पूरे ट्रैक्टर की फोटो *',
  'Tractor photo': 'ट्रैक्टर फोटो',
  '3. Chassis number on the tractor *': '3. ट्रैक्टर पर चेसिस नंबर *',
  'Type exactly what is punched on the chassis.': 'चेसिस पर जो नंबर खुदा है, वही लिखें।',
  '✓ Matches the stock list': '✓ स्टॉक लिस्ट से मेल खाता है',
  'Almost matches – check each character (0/O, 1/I, 5/S, 8/B).': 'लगभग मेल खाता है – हर अक्षर दोबारा देखें (0/O, 1/I, 5/S, 8/B)।',
  'Does not match the stock list ({c}).': 'स्टॉक लिस्ट ({c}) से मेल नहीं खाता।',
  'RC / registration number seen': 'दिखा RC / रजिस्ट्रेशन नंबर',
  Remarks: 'रिमार्क',
  'Optional (required for mismatch)': 'वैकल्पिक (मेल न खाने पर ज़रूरी)',
  '✓ Verified': '✓ सत्यापित',
  'Not found': 'नहीं मिला',
  'Currently marked': 'अभी की स्थिति',

  // extras
  'Remove extra tractor {x}?': 'अतिरिक्त ट्रैक्टर {x} हटाएँ?',
  'Tractors physically at the centre that are not in the stock list.': 'सेंटर पर मौजूद वे ट्रैक्टर जो स्टॉक लिस्ट में नहीं हैं।',
  'No reg. no': 'रजि. नंबर नहीं',
  Remove: 'हटाएँ',
  'Add extra tractor': 'अतिरिक्त ट्रैक्टर जोड़ें',
  'Registration no.': 'रजिस्ट्रेशन नंबर',
  'Chassis no.': 'चेसिस नंबर',
  'This chassis is in the stock list ({r}). Check it in the Stock tab instead.': 'यह चेसिस स्टॉक लिस्ट में है ({r})। इसे स्टॉक टैब में जाँचें।',
  'Add, then take photos': 'जोड़ें, फिर फोटो लें',

  // accessories
  'Remove {x}?': '{x} हटाएँ?',
  Photo: 'फोटो',
  'Add accessory': 'एक्सेसरी जोड़ें',
  Item: 'सामान',
  Qty: 'मात्रा',
  'e.g. 2 bundles of 5, 2 unpacked': 'जैसे 5-5 के 2 बंडल, 2 खुले',
  'Add, then take photo': 'जोड़ें, फिर फोटो लें',

  // facility
  'How is the stock kept? Rate each area and take at least one photo (racks, arrangement, condition of goods). A remark is required for Poor or Not applicable.':
    'स्टॉक कैसे रखा गया है? हर जगह को रेटिंग दें और कम से कम एक फोटो लें (रैक, सामान की जमावट, सामान की हालत)। खराब या लागू नहीं पर रिमार्क ज़रूरी है।',
  '{a}/{b} done': '{a}/{b} पूरे',
  'condition not rated': 'रेटिंग नहीं दी',
  'remark needed': 'रिमार्क ज़रूरी',
  '✓ Done': '✓ पूरा',
  Good: 'अच्छा',
  Average: 'ठीक-ठाक',
  Poor: 'खराब',
  'N/A': 'लागू नहीं',
  'Showroom display area': 'शोरूम डिस्प्ले एरिया',
  'Tractor yard / parking': 'ट्रैक्टर यार्ड / पार्किंग',
  'Accessories & spares racks': 'एक्सेसरीज़ और स्पेयर्स रैक',
  'Battery storage': 'बैटरी स्टोरेज',
  'Tyre storage': 'टायर स्टोरेज',
  'Overall cleanliness & safety (e.g. fire extinguisher)': 'साफ़-सफ़ाई और सुरक्षा (जैसे फ़ायर एक्सटिंग्विशर)',
  'Remark (required)': 'रिमार्क (ज़रूरी)',
  'Remark (optional) – e.g. racks labelled, batteries on floor': 'रिमार्क (वैकल्पिक) – जैसे रैक पर लेबल, बैटरी ज़मीन पर',
  'Remove this area': 'यह जगह हटाएँ',
  'Another area, e.g. Workshop': 'दूसरी जगह, जैसे वर्कशॉप',
  Add: 'जोड़ें',
  'Remove "{x}"?': '"{x}" हटाएँ?',

  // centre closed
  "Centre closed / can't audit?": 'सेंटर बंद है / ऑडिट नहीं हो सकता?',
  'Audit could not be carried out': 'ऑडिट नहीं हो सका',
  'Use this only if you are at {c} and the audit cannot be done today. The office will review it.':
    'इसका इस्तेमाल तभी करें जब आप {c} पर हों और आज ऑडिट नहीं हो सकता। ऑफ़िस इसे जाँचेगा।',
  'Reason *': 'कारण *',
  'Choose…': 'चुनें…',
  'Centre closed': 'सेंटर बंद है',
  'Manager / staff not available': 'मैनेजर / स्टाफ़ मौजूद नहीं',
  'Centre did not allow the audit': 'सेंटर ने ऑडिट नहीं करने दिया',
  'Holiday – centre shut for the day': 'छुट्टी – आज सेंटर बंद',
  Other: 'अन्य',
  'What happened? *': 'क्या हुआ? *',
  'Details (optional)': 'विवरण (वैकल्पिक)',
  'e.g. shutter down, manager phone switched off': 'जैसे शटर बंद, मैनेजर का फ़ोन बंद',
  'Photo of the storefront as proof *': 'सबूत के लिए शोरूम के सामने की फोटो *',
  'Send report': 'रिपोर्ट भेजें',
  'Choose the reason first.': 'पहले कारण चुनें।',
  'Explain what happened.': 'बताएँ क्या हुआ।',

  // finish
  '{n} tractor(s) not checked yet': '{n} ट्रैक्टर अभी नहीं जाँचे गए',
  '{n} tractor(s) without chassis photo': '{n} ट्रैक्टर की चेसिस फोटो बाकी',
  '{n} tractor(s) without tractor photo': '{n} ट्रैक्टर की पूरी फोटो बाकी',
  '{n} accessory item(s) without photo': '{n} एक्सेसरी की फोटो बाकी',
  'Storefront photo not taken (top of the page)': 'शोरूम फोटो नहीं ली (पेज के ऊपर)',
  '{n} facility area(s) not complete': '{n} सुविधा जगह अधूरी',
  Summary: 'सारांश',
  'Chassis mismatch': 'चेसिस मेल नहीं',
  'Not found (short)': 'नहीं मिले (कम)',
  'Accessory items': 'एक्सेसरी आइटम',
  'General remarks (optional)': 'सामान्य रिमार्क (वैकल्पिक)',
  'Auditor signature': 'ऑडिटर के हस्ताक्षर',
  'Outlet manager': 'आउटलेट मैनेजर',
  "Manager's name *": 'मैनेजर का नाम *',
  'Submit audit and check out': 'ऑडिट जमा करें और चेक-आउट करें',
  'After submitting you cannot edit unless the office sends it back.': 'जमा करने के बाद बदलाव नहीं कर सकेंगे, जब तक ऑफ़िस वापस न भेजे।',

  // error screen
  'Something went wrong on this screen': 'इस स्क्रीन पर कुछ गड़बड़ हो गई',
  'Your saved work is safe. Try reloading. If it keeps happening, send a screenshot of this message to the office.':
    'आपका सेव किया काम सुरक्षित है। दोबारा लोड करें। बार-बार हो तो इस संदेश का स्क्रीनशॉट ऑफ़िस को भेजें।',
  Reload: 'दोबारा लोड करें',

  // camera, photos, signature
  'Opening camera…': 'कैमरा खुल रहा है…',
  'Torch on': 'टॉर्च चालू',
  'Torch off': 'टॉर्च बंद',
  'Camera permission is blocked. Allow camera access for this app in your phone settings, then try again.':
    'कैमरा की अनुमति बंद है। फ़ोन की सेटिंग में इस ऐप को कैमरा की अनुमति दें, फिर दोबारा कोशिश करें।',
  'Could not open the front camera on this device.': 'इस फ़ोन का सामने वाला कैमरा नहीं खुला।',
  'Could not open the back camera on this device.': 'इस फ़ोन का पीछे वाला कैमरा नहीं खुला।',
  Retake: 'फिर से लें',
  'Take photo': 'फोटो लें',
  'Use photo': 'यह फोटो रखें',
  'Take selfie': 'सेल्फ़ी लें',
  Cancel: 'रद्द करें',
  'Add another': 'एक और जोड़ें',
  Retry: 'दोबारा भेजें',
  'Delete this photo?': 'यह फोटो हटाएँ?',
  Clear: 'मिटाएँ',
  'Save signature': 'हस्ताक्षर सेव करें',
  '✓ Saved': '✓ सेव हुआ',

  // messages from the server / phone
  'No internet connection. Check your mobile data and try again.': 'इंटरनेट नहीं है। मोबाइल डेटा चालू करके फिर कोशिश करें।',
  'Turn on location (GPS) to check in.': 'चेक-इन के लिए लोकेशन (GPS) चालू करें।',
  'Could not get your location. Turn on GPS and step outside if you are indoors.': 'आपकी लोकेशन नहीं मिली। GPS चालू करें और अंदर हों तो बाहर आएँ।',
  'Location permission is blocked. Allow location for this app in your phone settings.': 'लोकेशन की अनुमति बंद है। फ़ोन की सेटिंग में इस ऐप को लोकेशन की अनुमति दें।',
  'The audit is not complete yet.': 'ऑडिट अभी पूरा नहीं हुआ है।',
  "Enter the outlet manager's name.": 'आउटलेट मैनेजर का नाम लिखें।',
  'Auditor signature is missing.': 'ऑडिटर के हस्ताक्षर बाकी हैं।',
  "Outlet manager's signature is missing.": 'मैनेजर के हस्ताक्षर बाकी हैं।',
  'Storefront photo is missing.': 'शोरूम फोटो बाकी है।',
  'Please sign in again.': 'कृपया फिर से साइन इन करें।',
  'This audit has already been submitted.': 'यह ऑडिट पहले ही जमा हो चुका है।',
  'Check in first.': 'पहले चेक-इन करें।',
  'Take a photo of the storefront as proof.': 'सबूत के लिए शोरूम फोटो लें।',
  'Turn on location (GPS) – your location is needed as proof.': 'लोकेशन (GPS) चालू करें – सबूत के लिए लोकेशन ज़रूरी है।',
  'Something went wrong on the server. Please try again.': 'सर्वर पर कुछ गड़बड़ हुई। फिर से कोशिश करें।',
  'Could not process the photo.': 'फोटो प्रोसेस नहीं हो सकी।',
  'Enter the registration number or the chassis number.': 'रजिस्ट्रेशन नंबर या चेसिस नंबर लिखें।',
  'Enter the accessory name.': 'एक्सेसरी का नाम लिखें।',
  'This visit is not assigned to you.': 'यह विज़िट आपको नहीं सौंपी गई है।',
};

/** Messages that start with fixed text and end with names/numbers (e.g. lists of tractors). */
const HI_PREFIX: [string, string][] = [
  ['Chassis photo missing for: ', 'चेसिस फोटो बाकी: '],
  ['Tractor photo missing for: ', 'ट्रैक्टर फोटो बाकी: '],
  ['Photo missing for accessories: ', 'एक्सेसरी फोटो बाकी: '],
  ['Facility check incomplete: ', 'सुविधा जाँच अधूरी: '],
  ['You are still checked in at ', 'आप अभी भी चेक-इन हैं: '],
];
const HI_PATTERNS: [RegExp, string][] = [[/^(\d+) tractor\(s\) have not been checked yet\.$/, '$1 ट्रैक्टर अभी नहीं जाँचे गए।']];

export function translate(text: string, vars?: Record<string, string | number | null | undefined>, l: Lang = currentLang()): string {
  let out = text;
  if (l === 'hi') {
    if (HI[text]) out = HI[text];
    else {
      const p = HI_PREFIX.find(([en]) => text.startsWith(en));
      if (p) out = p[1] + text.slice(p[0].length);
      else for (const [re, hi] of HI_PATTERNS) if (re.test(text)) out = text.replace(re, hi);
    }
  }
  return vars ? out.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) : out;
}

/** Translator for components; re-renders when the language changes. */
export function useT() {
  const l = useSyncExternalStore(subscribe, currentLang, currentLang);
  return (text: string, vars?: Record<string, string | number | null | undefined>) => translate(text, vars, l);
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, () => lang, () => lang);
}

/** English / हिंदी switch. */
export function LangToggle({ dark }: { dark?: boolean }) {
  const l = useLang();
  const btn = (v: Lang, label: string) => (
    <button
      onClick={() => setLang(v)}
      aria-pressed={l === v}
      className={`rounded-md px-2 py-1 text-xs font-medium ${
        l === v ? (dark ? 'bg-white text-brand-900' : 'bg-brand-800 text-white') : dark ? 'text-white/80' : 'text-slate-600'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className={`inline-flex rounded-lg p-0.5 ${dark ? 'bg-white/10' : 'bg-slate-100'}`} role="group" aria-label="Language">
      {btn('en', 'English')}
      {btn('hi', 'हिंदी')}
    </div>
  );
}
