// A time zone by its current IANA name. Browsers still report some zones by the name they had before it was changed (Chrome
// says Asia/Calcutta for a device in India), which then sits beside the workspace's Asia/Kolkata as if it were another zone.

/** Former names of zones, to the name they have now (IANA's `backward` file, the ones a device is likely to report). */
const RENAMED: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Dacca": "Asia/Dhaka",
  "Asia/Thimbu": "Asia/Thimphu",
  "Asia/Ujung_Pandang": "Asia/Makassar",
  "Asia/Ulan_Bator": "Asia/Ulaanbaatar",
  "Asia/Macao": "Asia/Macau",
  "Asia/Istanbul": "Europe/Istanbul",
  "Europe/Kiev": "Europe/Kyiv",
  "America/Godthab": "America/Nuuk",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Africa/Asmera": "Africa/Asmara",
  "Pacific/Truk": "Pacific/Chuuk",
  "Pacific/Ponape": "Pacific/Pohnpei",
};

export const canonicalZone = (zone: string): string => RENAMED[zone] ?? zone;

/** The device's zone, by its current name. */
export const deviceZone = (): string => canonicalZone(Intl.DateTimeFormat().resolvedOptions().timeZone);

/** A list of zone names by their current names, each once. */
export const canonicalZones = (zones: string[]): string[] => [...new Set(zones.map(canonicalZone))];
