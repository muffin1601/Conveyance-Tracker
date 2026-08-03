/**
 * Minimal, dependency-free bilingual support (English / Hindi) for the
 * employee-facing Check In page.
 *
 * Deliberately not next-intl/react-i18next: the app has exactly two
 * languages and one primary screen to cover, so a flat dictionary plus one
 * lookup function is the honest tool — no routing changes, no new
 * dependency, no config to maintain.
 *
 * The language choice lives in a cookie (same pattern as `watcon_employee` in
 * lib/auth.ts), so the server component renders the right language on the
 * very first paint — no flash of English before a client-side toggle kicks
 * in, which matters for a "foolproof for non-technical users" screen.
 */

export const LANG_COOKIE = "watcon_lang";
export type Lang = "en" | "hi";
export const DEFAULT_LANG: Lang = "en";

export function isLang(v: string | undefined): v is Lang {
  return v === "en" || v === "hi";
}

/**
 * Every user-facing string on the Check In page. Keys are the English text's
 * intent, not the text itself, so a copy change never silently breaks a
 * lookup. Grouped by the section of the page they appear in.
 */
const DICT = {
  // ── Navigation ──────────────────────────────────────────────────
  navCheckIn: { en: "Check In", hi: "चेक इन" },
  navAdmin: { en: "Admin", hi: "एडमिन" },
  navSettings: { en: "Settings", hi: "सेटिंग्स" },
  languageToggle: { en: "हिंदी", hi: "English" },

  // ── Page intro ──────────────────────────────────────────────────
  logSiteVisit: { en: "Log Site Visit", hi: "साइट विज़िट दर्ज करें" },
  introFirstTrip: {
    en: "Your first trip starts from {office} by default (a different starting point can be set for you in Settings). After that, each visit starts from your last destination. Distance & amount are calculated automatically.",
    hi: "आपकी पहली trip डिफ़ॉल्ट रूप से {office} से शुरू होती है (Settings में आपके लिए अलग starting point सेट किया जा सकता है)। उसके बाद, हर visit आपकी पिछली जगह से शुरू होगी। Distance और amount अपने आप निकल जाएगा।",
  },
  miscExpensesTitle: { en: "Miscellaneous Expenses", hi: "अन्य खर्चे" },
  miscExpensesIntro: {
    en: "Record non-conveyance expenses — parking, toll, food, and more. These are kept separate from conveyance but appear in your day summary and reports.",
    hi: "आने-जाने के अलावा के खर्चे यहाँ दर्ज करें — parking, toll, खाना, वगैरह। ये conveyance से अलग रखे जाते हैं, पर आपकी day summary और reports में दिख जाते हैं।",
  },
  todaysSummary: { en: "Today's Summary", hi: "आज का हिसाब" },

  // ── Employee picker ─────────────────────────────────────────────
  yourName: { en: "Your Name", hi: "आपका नाम" },
  selectYourName: { en: "— Select your name —", hi: "— अपना नाम चुनें —" },
  searchByName: { en: "Search by name, role or department…", hi: "नाम, role या department से खोजें…" },
  noEmployeeMatch: { en: "No employee matches that search.", hi: "इस खोज से कोई employee नहीं मिला।" },

  // ── Trip header ─────────────────────────────────────────────────
  trip: { en: "Trip", hi: "Trip" },
  startingNewJourney: { en: "Starting a new journey", hi: "नई journey शुरू हो रही है" },
  resetJourney: { en: "Reset Journey", hi: "Journey Reset करें" },
  startingPoint: { en: "Starting Point", hi: "शुरुआती जगह" },
  destination: { en: "Destination", hi: "मंज़िल" },
  notSelectedYet: { en: "Not selected yet", hi: "अभी चुना नहीं गया" },
  auto: { en: "auto", hi: "auto" },
  carriedOver: { en: "Carried over from your last trip", hi: "आपकी पिछली trip से आगे बढ़ा" },
  todaysDistance: { en: "Today's Distance", hi: "आज की दूरी" },
  todaysConveyance: { en: "Today's Conveyance", hi: "आज का Conveyance" },

  // ── Destination picker ──────────────────────────────────────────
  whereGoing: { en: "Where Are You Going", hi: "आप कहाँ जा रहे हैं" },
  selectLocation: { en: "— Select a location —", hi: "— जगह चुनें —" },
  searchLocations: { en: "Search locations…", hi: "जगह खोजें…" },
  noLocationMatch: { en: "No location matches that search.", hi: "इस खोज से कोई जगह नहीं मिली।" },
  useCurrentGps: { en: "Use Current GPS", hi: "अभी की Location Use करें" },

  // ── GPS panel ────────────────────────────────────────────────────
  gpsHeading: { en: "Use My Current Location", hi: "मेरी अभी की Location Use करें" },
  getMyLocation: { en: "📍 Get My Current Location", hi: "📍 मेरी Location लें" },
  findingLocation: { en: "Finding your location…", hi: "आपकी location ढूँढी जा रही है…" },
  almostReady: { en: "Almost ready… checking your location…", hi: "बस थोड़ी देर… location जाँची जा रही है…" },
  pleaseWait: { en: "Please wait 5–10 seconds.", hi: "कृपया 5–10 सेकंड रुकें।" },
  allowPermissionTitle: { en: "Please allow location permission", hi: "कृपया location की permission दें" },
  allowPermissionBody: { en: "Tap Allow when your phone asks — then press the button below again.", hi: "जब फ़ोन पूछे तो Allow दबाएँ — फिर नीचे वाला बटन फिर से दबाएँ।" },
  gpsUnavailable: { en: "We couldn't find your location. Please move near a window or outside, then try again.", hi: "आपकी location नहीं मिल पाई। कृपया खिड़की के पास या बाहर जाकर फिर कोशिश करें।" },
  browserNoGps: { en: "This phone or browser can't share your location. Please add the location manually.", hi: "यह phone या browser location share नहीं कर सकता। कृपया location खुद डालें।" },
  tryAgain: { en: "Try Again", hi: "फिर कोशिश करें" },
  locationFound: { en: "Location Found", hi: "Location मिल गई" },
  locationVerified: { en: "Location Verified", hi: "Location सही है" },
  awayFrom: { en: "away", hi: "दूर" },
  confirmLocation: { en: "✅ Confirm This Location", hi: "✅ यह Location Confirm करें" },
  saveForNextTime: { en: "Save this place for next time?", hi: "अगली बार के लिए यह जगह save करें?" },
  savedDone: { en: "Saved.", hi: "Save हो गया।" },
  giveItAName: { en: "Give it a name", hi: "इसे एक नाम दें" },
  save: { en: "Save", hi: "Save करें" },

  // ── Transport ────────────────────────────────────────────────────
  modeOfTransport: { en: "Mode of Transport", hi: "यात्रा का साधन" },
  bike: { en: "Bike", hi: "Bike" },
  car: { en: "Car", hi: "Car" },
  busMetro: { en: "Bus/Metro", hi: "Bus/Metro" },
  perKm: { en: "/km", hi: "/km" },
  orActual: { en: "or actual", hi: "या actual" },
  actualFare: { en: "Actual Fare (₹) — optional", hi: "असली किराया (₹) — वैकल्पिक" },
  leaveBlankAutoCalc: { en: "Leave blank to auto-calculate by distance", hi: "खाली छोड़ें, दूरी से अपने आप निकल जाएगा" },

  // ── Manual distance ──────────────────────────────────────────────
  enterDistanceManually: { en: "Enter distance manually (if automatic calculation is unavailable)", hi: "दूरी खुद डालें (अगर अपने आप नहीं निकल पा रही)" },
  distanceInKm: { en: "Distance in km", hi: "दूरी (km में)" },

  // ── Preview / submit ─────────────────────────────────────────────
  calculating: { en: "Calculating distance and fare…", hi: "दूरी और किराया निकाला जा रहा है…" },
  distance: { en: "Distance", hi: "दूरी" },
  fare: { en: "Fare", hi: "किराया" },
  manualEntry: { en: "distance entered manually", hi: "दूरी खुद डाली गई" },
  enterDistanceAbove: { en: "Enter the distance above to see the fare.", hi: "किराया देखने के लिए ऊपर दूरी डालें।" },
  alreadyHere: { en: "You are already at this location — pick a different destination.", hi: "आप पहले से यहीं हैं — कोई और जगह चुनें।" },
  logThisVisit: { en: "Log This Visit", hi: "यह Visit दर्ज करें" },
  loggingInProgress: { en: "Logging…", hi: "दर्ज हो रहा है…" },

  // ── Trip timeline ────────────────────────────────────────────────
  recentTripsToday: { en: "Recent Trips Today", hi: "आज की Trips" },
  journeyRestarted: { en: "Journey was restarted after this trip", hi: "इस trip के बाद journey फिर से शुरू हुई" },
  journeyTotal: { en: "Journey Total", hi: "कुल Journey" },

  // ── Misc expenses ────────────────────────────────────────────────
  employee: { en: "Employee", hi: "कर्मचारी" },
  addExpense: { en: "Add Expense", hi: "खर्चा जोड़ें" },
  noExpensesRecorded: { en: "No miscellaneous expenses recorded.", hi: "कोई अन्य खर्चा दर्ज नहीं है।" },
  miscTotal: { en: "Miscellaneous Total", hi: "कुल अन्य खर्चा" },
  newExpense: { en: "New expense", hi: "नया खर्चा" },
  editExpense: { en: "Edit expense", hi: "खर्चा बदलें" },
  category: { en: "Category", hi: "Category" },
  date: { en: "Date", hi: "तारीख" },
  customCategory: { en: "Custom Category", hi: "अपनी Category" },
  enterCategory: { en: "Enter category", hi: "Category लिखें" },
  amount: { en: "Amount (₹)", hi: "राशि (₹)" },
  description: { en: "Description", hi: "विवरण" },
  optional: { en: "Optional", hi: "वैकल्पिक" },
  notes: { en: "Notes", hi: "Notes" },
  billAttachment: { en: "Bill / Attachment", hi: "Bill / फ़ोटो" },
  saveChanges: { en: "Save Changes", hi: "बदलाव Save करें" },
  cancel: { en: "Cancel", hi: "रद्द करें" },

  // ── Today's Summary (page.tsx) ───────────────────────────────────
  selectNameToSeeTrips: { en: "Select your name above to see your trips and expenses for today.", hi: "आज की trips और खर्चे देखने के लिए ऊपर अपना नाम चुनें।" },
  noActivityToday: { en: "No activity logged today yet.", hi: "आज अभी तक कुछ दर्ज नहीं हुआ।" },
  conveyanceLabel: { en: "Conveyance", hi: "Conveyance" },
  totalConveyanceLabel: { en: "Total Conveyance", hi: "कुल Conveyance" },
  miscellaneousLabel: { en: "Miscellaneous", hi: "अन्य खर्चे" },
  totalMiscLabel: { en: "Total Miscellaneous", hi: "कुल अन्य खर्चे" },
  grandTotal: { en: "Grand Total", hi: "कुल जोड़" },

  // ── Validation & status messages ─────────────────────────────────
  selectNameContinue: { en: "Select your name to continue.", hi: "जारी रखने के लिए अपना नाम चुनें।" },
  chooseDestination: { en: "Choose where you are going.", hi: "आप कहाँ जा रहे हैं, यह चुनें।" },
  enterDistanceValid: { en: "Enter the distance in km (a number greater than 0).", hi: "दूरी km में डालें (0 से बड़ी संख्या)।" },
  enterValidFare: { en: "Enter a valid fare amount, or leave it blank.", hi: "सही किराया डालें, या खाली छोड़ दें।" },
  tripLoggedMsg: { en: "Trip {n} logged · {from} → {to} · {km} · {amount}.", hi: "Trip {n} दर्ज हुई · {from} → {to} · {km} · {amount}।" },
  confirmResetJourney: { en: "Restart the journey? Your next trip will start from your usual starting point again. Trips already logged are kept.", hi: "Journey फिर से शुरू करें? आपकी अगली trip फिर से आपकी सामान्य जगह से शुरू होगी। पहले से दर्ज trips नहीं हटेंगी।" },
  journeyRestartedMsg: { en: "Journey restarted — your next trip starts from {from}.", hi: "Journey फिर से शुरू हुई — आपकी अगली trip {from} से शुरू होगी।" },
  savedLocationLabel: { en: "Saved location", hi: "Saved location" },
  selectedSiteLabel: { en: "Selected site", hi: "चुनी हुई site" },
  newLocationDefault: { en: "New location", hi: "नई जगह" },
  clearGpsDestination: { en: "Clear GPS destination", hi: "GPS destination हटाएँ" },

  // ── Misc expenses (extra) ────────────────────────────────────────
  tryAgainLower: { en: "Try again", hi: "फिर कोशिश करें" },
  loadingExpenses: { en: "Loading expenses", hi: "खर्चे लोड हो रहे हैं" },
  editAria: { en: "Edit", hi: "बदलें" },
  confirmDeleteAria: { en: "Confirm delete", hi: "हटाना confirm करें" },
  cancelAria: { en: "Cancel", hi: "रद्द करें" },
  deleteAria: { en: "Delete", hi: "हटाएँ" },
  enterAmountPositive: { en: "Enter an amount greater than ₹0.", hi: "₹0 से ज़्यादा राशि डालें।" },
  amountTooLarge: { en: "That amount looks too large — please check it.", hi: "यह राशि बहुत बड़ी लग रही है — कृपया जाँच लें।" },
  enterCustomCategoryError: { en: "Enter a custom category for “Other”.", hi: "“Other” के लिए category लिखें।" },
  chooseValidDate: { en: "Choose a valid date.", hi: "सही तारीख चुनें।" },
  dateNotFuture: { en: "The date cannot be in the future.", hi: "तारीख आने वाले समय की नहीं हो सकती।" },
  billDisabledNote: { en: "Bill attachments are currently disabled. The expense will still be saved.", hi: "Bill attach करना अभी बंद है। खर्चा फिर भी save हो जाएगा।" },
  billAttached: { en: "Bill attached", hi: "Bill लगा है" },
  replaceLabel: { en: "Replace", hi: "बदलें" },
  removeLabel: { en: "Remove", hi: "हटाएँ" },
  keepExistingBill: { en: "Keep existing bill instead", hi: "पुराना bill ही रखें" },
  enterCategoryPlaceholder: { en: "Enter category", hi: "Category लिखें" },

  // ── Bill upload box ───────────────────────────────────────────────
  browseOrDrag: { en: "Browse", hi: "चुनें" },
  browseOrDragSuffix: { en: "or drag & drop a bill", hi: "या bill drag & drop करें" },
  billTypesHint: { en: "PDF, PNG, JPG, JPEG, WEBP · max {mb} MB", hi: "PDF, PNG, JPG, JPEG, WEBP · ज़्यादा से ज़्यादा {mb} MB" },
  uploading: { en: "Uploading…", hi: "Upload हो रहा है…" },
  uploadedDone: { en: "Uploaded ✓", hi: "Upload हो गया ✓" },
  retry: { en: "Retry", hi: "फिर कोशिश करें" },
  removeAttachment: { en: "Remove attachment", hi: "Attachment हटाएँ" },
  fileEmpty: { en: "The selected file is empty.", hi: "चुनी हुई file खाली है।" },
  fileTooLarge: { en: "File too large (max {mb} MB).", hi: "File बहुत बड़ी है (ज़्यादा से ज़्यादा {mb} MB)।" },
  fileUnsupportedType: { en: "Unsupported type. Allowed: PDF, PNG, JPG, JPEG, WEBP.", hi: "यह type सही नहीं है। सही types: PDF, PNG, JPG, JPEG, WEBP." },
  uploadFailed: { en: "Upload failed ({status}).", hi: "Upload नहीं हो पाया ({status})।" },
  uploadNetworkError: { en: "Network error during upload.", hi: "Upload के दौरान network में गड़बड़ी हुई।" },
  uploadCancelled: { en: "Upload cancelled.", hi: "Upload रद्द हो गया।" },
  uploadTimedOut: { en: "Upload timed out.", hi: "Upload का समय खत्म हो गया।" },

  // ── Bill actions (view / download) ──────────────────────────────
  viewBill: { en: "View bill", hi: "Bill देखें" },
  view: { en: "View", hi: "देखें" },
  downloadBill: { en: "Download bill", hi: "Bill download करें" },
  download: { en: "Download", hi: "Download करें" },

  // ── Journey bill (per-leg attach) ────────────────────────────────
  addBill: { en: "Add bill", hi: "Bill जोड़ें" },
  removeBill: { en: "Remove bill", hi: "Bill हटाएँ" },
} as const;

export type DictKey = keyof typeof DICT;

/** Look up one string, substituting any `{placeholder}` values given. */
export function t(lang: Lang, key: DictKey, vars?: Record<string, string>): string {
  let text: string = DICT[key][lang];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, v);
  }
  return text;
}
