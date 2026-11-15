// App Store storefronts, and the three ways Apple's feeds name them.
//
// Sales and Trends writes ISO 3166-1 alpha-2 ("US"), customer reviews write
// alpha-3 ("USA"), and the public lookup service wants a lowercase alpha-2 in
// its URL. Everything in this feature is keyed by the two letter code, so each
// feed converts on the way in through territoryCode().
//
// The third column is the listing language a shopper in that storefront is
// most likely to read, as an App Store Connect locale. It drives the
// "people here see your listing in another language" insight, so it names the
// majority language only, and English where App Store Connect has no listing
// language for the local one.

const TABLE = `
AF AFG en-US|AL ALB en-US|DZ DZA ar-SA|AO AGO pt-PT|AI AIA en-US|AG ATG en-US|AR ARG es-MX|AM ARM en-US
AU AUS en-AU|AT AUT de-DE|AZ AZE en-US|BS BHS en-US|BH BHR ar-SA|BB BRB en-US|BY BLR ru|BE BEL nl-NL
BZ BLZ en-US|BJ BEN fr-FR|BM BMU en-US|BT BTN en-US|BO BOL es-MX|BA BIH hr|BW BWA en-US|BR BRA pt-BR
VG VGB en-US|BN BRN ms|BG BGR en-US|BF BFA fr-FR|KH KHM en-US|CM CMR fr-FR|CA CAN en-CA|CV CPV pt-PT
KY CYM en-US|TD TCD fr-FR|CL CHL es-MX|CN CHN zh-Hans|CO COL es-MX|CG COG fr-FR|CD COD fr-FR|CR CRI es-MX
CI CIV fr-FR|HR HRV hr|CY CYP el|CZ CZE cs|DK DNK da|DM DMA en-US|DO DOM es-MX|EC ECU es-MX
EG EGY ar-SA|SV SLV es-MX|EE EST en-US|SZ SWZ en-US|FJ FJI en-US|FI FIN fi|FR FRA fr-FR|GA GAB fr-FR
GM GMB en-US|GE GEO en-US|DE DEU de-DE|GH GHA en-US|GR GRC el|GD GRD en-US|GT GTM es-MX|GW GNB pt-PT
GY GUY en-US|HN HND es-MX|HK HKG zh-Hant|HU HUN hu|IS ISL en-US|IN IND en-US|ID IDN id|IQ IRQ ar-SA
IE IRL en-GB|IL ISR he|IT ITA it|JM JAM en-US|JP JPN ja|JO JOR ar-SA|KZ KAZ ru|KE KEN en-US
KR KOR ko|XK XKS en-US|KW KWT ar-SA|KG KGZ ru|LA LAO en-US|LV LVA en-US|LB LBN ar-SA|LR LBR en-US
LY LBY ar-SA|LT LTU en-US|LU LUX fr-FR|MO MAC zh-Hant|MG MDG fr-FR|MW MWI en-US|MY MYS ms|MV MDV en-US
ML MLI fr-FR|MT MLT en-GB|MR MRT ar-SA|MU MUS en-US|MX MEX es-MX|FM FSM en-US|MD MDA ro|MN MNG en-US
ME MNE hr|MS MSR en-US|MA MAR fr-FR|MZ MOZ pt-PT|MM MMR en-US|NA NAM en-US|NR NRU en-US|NP NPL en-US
NL NLD nl-NL|NZ NZL en-AU|NI NIC es-MX|NE NER fr-FR|NG NGA en-US|MK MKD en-US|NO NOR no|OM OMN ar-SA
PK PAK en-US|PW PLW en-US|PA PAN es-MX|PG PNG en-US|PY PRY es-MX|PE PER es-MX|PH PHL en-US|PL POL pl
PT PRT pt-PT|QA QAT ar-SA|RO ROU ro|RU RUS ru|RW RWA en-US|KN KNA en-US|LC LCA en-US|VC VCT en-US
ST STP pt-PT|SA SAU ar-SA|SN SEN fr-FR|RS SRB hr|SC SYC en-US|SL SLE en-US|SG SGP en-GB|SK SVK sk
SI SVN en-US|SB SLB en-US|ZA ZAF en-GB|ES ESP es-ES|LK LKA en-US|SR SUR nl-NL|SE SWE sv|CH CHE de-DE
TW TWN zh-Hant|TJ TJK ru|TZ TZA en-US|TH THA th|TO TON en-US|TT TTO en-US|TN TUN fr-FR|TR TUR tr
TM TKM ru|TC TCA en-US|UG UGA en-US|UA UKR uk|AE ARE ar-SA|GB GBR en-GB|US USA en-US|UY URY es-MX
UZ UZB ru|VU VUT en-US|VE VEN es-MX|VN VNM vi|YE YEM ar-SA|ZM ZMB en-US|ZW ZWE en-US
`;

interface TerritoryRow {
  iso2: string;
  iso3: string;
  language: string;
}

const ROWS: TerritoryRow[] = TABLE.split(/[|\n]/)
  .map((cell) => cell.trim())
  .filter(Boolean)
  .map((cell) => {
    const [iso2, iso3, language] = cell.split(/\s+/);
    return { iso2, iso3, language };
  });

const BY_ISO2 = new Map(ROWS.map((row) => [row.iso2, row]));
const BY_ISO3 = new Map(ROWS.map((row) => [row.iso3, row]));

/** Every storefront, as two letter codes. */
export const TERRITORY_CODES: string[] = ROWS.map((row) => row.iso2);

/** Stand-in for a row that named no territory. */
export const UNKNOWN_TERRITORY = 'ZZ';

/** Names Apple writes that Intl does not produce. */
const NAME_ALIASES: Record<string, string> = {
  'korea, republic of': 'KR',
  'republic of korea': 'KR',
  'south korea': 'KR',
  turkey: 'TR',
  'türkiye': 'TR',
  macao: 'MO',
  macau: 'MO',
  'hong kong': 'HK',
  'taiwan, province of china': 'TW',
  "cote d'ivoire": 'CI',
  "côte d'ivoire": 'CI',
  'ivory coast': 'CI',
  'congo, republic of': 'CG',
  'congo, democratic republic of the': 'CD',
  'democratic republic of the congo': 'CD',
  'lao peoples democratic republic': 'LA',
  laos: 'LA',
  'russian federation': 'RU',
  'viet nam': 'VN',
  'united states of america': 'US',
  usa: 'US',
  uk: 'GB',
  'great britain': 'GB',
  'czechia': 'CZ',
  'st. kitts and nevis': 'KN',
  'st. lucia': 'LC',
  'st. vincent and the grenadines': 'VC',
  'sao tome and principe': 'ST',
  'são tomé and príncipe': 'ST',
  'north macedonia': 'MK',
  'macedonia': 'MK',
  eswatini: 'SZ',
  swaziland: 'SZ',
  'micronesia, federated states of': 'FM',
  'moldova, republic of': 'MD',
  'tanzania, united republic of': 'TZ',
  'brunei darussalam': 'BN',
};

let displayNames: Intl.DisplayNames | null | undefined;

function names(): Intl.DisplayNames | null {
  if (displayNames !== undefined) return displayNames;
  try {
    displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    displayNames = null;
  }
  return displayNames;
}

let byName: Map<string, string> | null = null;

function nameIndex(): Map<string, string> {
  if (byName) return byName;
  byName = new Map(Object.entries(NAME_ALIASES));
  const intl = names();
  for (const row of ROWS) {
    const name = intl?.of(row.iso2);
    if (name) byName.set(name.toLowerCase(), row.iso2);
  }
  return byName;
}

/**
 * Whatever a feed wrote, as a two letter code: "US", "USA", "us" and
 * "United States" all come back "US". An empty value is UNKNOWN_TERRITORY; a
 * code this table has never heard of is kept, uppercased, rather than dropped,
 * so a storefront Apple adds later still shows up under its own code.
 */
export function territoryCode(value: string | null | undefined): string {
  const text = (value ?? '').trim();
  if (!text) return UNKNOWN_TERRITORY;
  const upper = text.toUpperCase();
  if (upper.length === 2 && /^[A-Z]{2}$/.test(upper)) return upper;
  if (upper.length === 3 && /^[A-Z]{3}$/.test(upper)) return BY_ISO3.get(upper)?.iso2 ?? upper;
  return nameIndex().get(text.toLowerCase()) ?? upper;
}

export function territoryName(code: string): string {
  if (code === UNKNOWN_TERRITORY) return 'Unknown';
  if (code === 'XK') return 'Kosovo';
  try {
    return names()?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** The App Store Connect listing language most shoppers in this storefront read. */
export function listingLanguageFor(code: string): string {
  return BY_ISO2.get(code)?.language ?? 'en-US';
}

/** The storefront's three letter code, for Apple endpoints that want one. */
export function territoryIso3(code: string): string | null {
  return BY_ISO2.get(code)?.iso3 ?? null;
}

/**
 * Google Play's codes for the languages App Store Connect names otherwise:
 * Play writes Chinese by region and Hebrew with its old code.
 */
const PLAY_TO_APPLE: Record<string, string> = {
  'zh-CN': 'zh-Hans',
  'zh-TW': 'zh-Hant',
  'zh-HK': 'zh-Hant',
  'iw-IL': 'he',
  iw: 'he',
};

/** A store page language in App Store Connect's codes, so the two stores' languages compare. */
export function appleLanguageOf(locale: string): string {
  return PLAY_TO_APPLE[locale] ?? locale;
}

/**
 * Whether a listing language covers a storefront's language, by its base:
 * an en-GB listing serves a storefront that reads en-US, but zh-Hans does not
 * serve zh-Hant, which is a different written language. Takes Google Play's
 * codes as well (zh-CN, iw-IL).
 */
export function languageCovers(listingLocale: string, wanted: string): boolean {
  const left = appleLanguageOf(listingLocale);
  const right = appleLanguageOf(wanted);
  if (left === right) return true;
  const base = (locale: string) => (locale.startsWith('zh') ? locale : locale.split('-')[0]);
  return base(left) === base(right);
}

/** Every listing language App Store Connect offers, as its locale codes. */
export const LISTING_LANGUAGES = [
  'ar-SA', 'ca', 'cs', 'da', 'de-DE', 'el', 'en-AU', 'en-CA', 'en-GB', 'en-US', 'es-ES', 'es-MX', 'fi', 'fr-CA',
  'fr-FR', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'ms', 'nl-NL', 'no', 'pl', 'pt-BR', 'pt-PT', 'ro', 'ru',
  'sk', 'sv', 'th', 'tr', 'uk', 'vi', 'zh-Hans', 'zh-Hant',
];

/**
 * Where two listing languages share a base, the variant has to be named or
 * the sentence is ambiguous: "Portuguese" could be either listing. Everywhere
 * else the base name reads better than Intl's "German (Germany)".
 */
const VARIANT_NAMES: Record<string, string> = {
  'pt-BR': 'Brazilian Portuguese',
  'pt-PT': 'European Portuguese',
  'zh-Hans': 'Simplified Chinese',
  'zh-Hant': 'Traditional Chinese',
  'es-MX': 'Latin American Spanish',
  'es-ES': 'Spanish',
  'fr-CA': 'Canadian French',
  // Google Play's codes, and the English variants a Play store page often has side by side.
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
  'zh-HK': 'Chinese (Hong Kong)',
  'es-419': 'Latin American Spanish',
  'es-US': 'Spanish (United States)',
  'iw-IL': 'Hebrew',
  'en-GB': 'British English',
  'en-AU': 'Australian English',
  'en-CA': 'Canadian English',
  'en-IN': 'English (India)',
  'en-SG': 'English (Singapore)',
  'en-ZA': 'English (South Africa)',
};

/** "German", "Brazilian Portuguese" and so on, for an App Store Connect or Google Play locale. */
export function listingLanguageName(locale: string): string {
  if (VARIANT_NAMES[locale]) return VARIANT_NAMES[locale];
  try {
    const intl = new Intl.DisplayNames(['en'], { type: 'language' });
    return intl.of(locale.split('-')[0]) ?? locale;
  } catch {
    return locale;
  }
}
