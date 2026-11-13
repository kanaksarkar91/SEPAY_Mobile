/**
 * Date and Time Formatting Utilities for SE PAY
 * Provides consistent date and time formatting throughout the app,
 * parsing UTC server timestamps from the backend and converting them
 * accurately into the user's local device timezone.
 */

const MONTH_NAMES_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Server Primary Timezone (Australia/Sydney) - maintained for backward compatibility
 */
export const SYDNEY_TIMEZONE = 'Australia/Sydney';

/**
 * India Standard Time (IST - Asia/Kolkata, UTC+05:30)
 */
export const INDIA_TIMEZONE = 'Asia/Kolkata';

/**
 * Legacy utility: Calculates a true UTC Date from Sydney local date/time components.
 * Automatically accounts for Australian Daylight Saving Time (AEDT UTC+11 vs AEST UTC+10).
 */
export function calculateSydneyUtcDate(
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
  s: number
): Date | null {
  const guessEpoch = Date.UTC(y, m - 1, d, h, min, s);

  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: SYDNEY_TIMEZONE,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    });

    const parts = dtf.formatToParts(new Date(guessEpoch));
    const getPart = (type: string) => parts.find((p) => p.type === type)?.value;

    let sHour = parseInt(getPart('hour') || '0', 10);
    if (sHour === 24) sHour = 0;

    const sydneyEpoch = Date.UTC(
      parseInt(getPart('year') || String(y), 10),
      parseInt(getPart('month') || String(m), 10) - 1,
      parseInt(getPart('day') || String(d), 10),
      sHour,
      parseInt(getPart('minute') || String(min), 10),
      parseInt(getPart('second') || String(s), 10)
    );

    const offset = sydneyEpoch - guessEpoch;
    const actualUtc = new Date(guessEpoch - offset);
    return isNaN(actualUtc.getTime()) ? null : actualUtc;
  } catch {
    // Fallback: Default to AEDT (UTC+11)
    const fallback = new Date(guessEpoch - 11 * 3600 * 1000);
    return isNaN(fallback.getTime()) ? null : fallback;
  }
}

/**
 * Parses a date or timestamp sent by the backend in UTC:
 * - SQL string: "YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DD HH:mm:ss.SSSSSS"
 * - ISO string: "YYYY-MM-DDTHH:mm:ss" or "YYYY-MM-DDTHH:mm:ss.SSSZ"
 * - Explicit offset: "2026-11-12T11:37:26+00:00"
 * - Date only: "YYYY-MM-DD" (preserved as local calendar date)
 * - Time only: "HH:mm:ss" or "HH:mm AM/PM" (anchored to current UTC day)
 * - Number (timestamp in ms)
 * - Date object
 * - Payload object containing date fields (e.g. transaction_date, start_at, session_date)
 *
 * Returns a standard JavaScript Date object representing that instant in time.
 */
export function parseUtcDate(
  input: string | number | Date | null | undefined | any
): Date | null {
  if (!input) return null;

  // If an object with a timestamp field is passed (e.g. API transaction or shift payload)
  if (typeof input === 'object' && !(input instanceof Date)) {
    const extracted =
      input.transaction_date ||
      input.date_time ||
      input.date ||
      input.created_at ||
      input.created_ts ||
      input.timestamp ||
      input.start_at ||
      input.end_at ||
      input.session_date;
    if (!extracted) return null;
    input = extracted;
  }

  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  if (typeof input === 'number') {
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }

  const str = String(input).trim();
  if (!str) return null;

  // If already ends with an explicit UTC or timezone offset (e.g. Z, +00:00, +11:00, -05:00)
  if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(str)) {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  // Check for full date or date+time string: YYYY-MM-DD or YYYY-MM-DD HH:mm:ss[.SSS]
  const match = str.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d+))?)?/
  );

  if (match) {
    const y = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const d = parseInt(match[3], 10);

    // If no time component is provided (date only: e.g. "2026-11-12"),
    // preserve the calendar date in local timezone so the day does not shift across timezones
    if (match[4] === undefined) {
      const localDate = new Date(y, m - 1, d);
      return isNaN(localDate.getTime()) ? null : localDate;
    }

    const h = parseInt(match[4], 10);
    const min = match[5] ? parseInt(match[5], 10) : 0;
    const s = match[6] ? parseInt(match[6], 10) : 0;
    const ms = match[7] ? parseInt(match[7].slice(0, 3).padEnd(3, '0'), 10) : 0;

    // Backend sends timestamp in UTC. Construct true UTC Date:
    const utcEpoch = Date.UTC(y, m - 1, d, h, min, s, ms);
    const utcDate = new Date(utcEpoch);
    return isNaN(utcDate.getTime()) ? null : utcDate;
  }

  // Check if it's a time-only string like "10:26 PM" or "22:26:53"
  const timeMatch = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (timeMatch) {
    let h = parseInt(timeMatch[1], 10);
    const m = parseInt(timeMatch[2], 10);
    const s = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
    const ampm = timeMatch[4]?.toUpperCase();
    if (ampm === 'PM' && h < 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;

    // Anchor to today's UTC day
    const now = new Date();
    const uy = now.getUTCFullYear();
    const um = now.getUTCMonth();
    const ud = now.getUTCDate();
    const utcEpoch = Date.UTC(uy, um, ud, h, m, s);
    const utcDate = new Date(utcEpoch);
    return isNaN(utcDate.getTime()) ? null : utcDate;
  }

  // Fallback standard parse
  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? null : fallback;
}

/**
 * Backward compatibility alias: parseSydneyDate now delegates to parseUtcDate
 * since the backend now sends timestamps in UTC format.
 */
export const parseSydneyDate = parseUtcDate;

/**
 * Checks if a string or value has an explicit time component
 * (e.g. "14:30:00", "2026-11-12 14:30:00", "2026-11-12T14:30:00Z").
 */
export function hasTimeComponent(input: string | number | Date | null | undefined): boolean {
  if (!input) return false;
  if (input instanceof Date || typeof input === 'number') return true;
  const str = String(input).trim();
  return /[ T]\d{1,2}:\d{2}/.test(str) || /^\d{1,2}:\d{2}/.test(str);
}

/**
 * Formats a UTC timestamp (e.g. start_at, end_at, transaction_date) to the user's local time:
 * e.g. "4:56 PM" or "10:26 PM" (based on device/user timezone).
 * Note: If passed a date-only string without time (e.g. "2026-11-12"), returns empty string
 * instead of assuming 00:00:00 (12:00 AM).
 */
export function formatUtcToUserTime(
  input: string | number | Date | null | undefined
): string {
  if (!input) return '';

  // Avoid returning "12:00 AM" for calendar date strings that lack time
  if (typeof input === 'string' && !hasTimeComponent(input)) {
    return '';
  }

  const date = parseUtcDate(input);
  if (!date || isNaN(date.getTime())) return '';

  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;

  return `${hours}:${minutes} ${ampm}`;
}

export const formatSydneyToUserTime = formatUtcToUserTime;

/**
 * Safely resolves and formats a transaction or trip's time in the user's local timezone.
 * Handles all combinations of created_at, date + time, date_time, time_formatted, etc.
 * Avoids showing "12:00 AM" when only a date (e.g. "2026-11-12") is present.
 */
export function formatTxnTime(txn?: {
  created_at?: string | null;
  date?: string | null;
  time?: string | null;
  time_formatted?: string | null;
  receipt?: { date_time?: string | null } | null;
} | null): string {
  if (!txn) return '--';

  return (
    (txn.created_at ? formatUtcToUserTime(txn.created_at) : null) ||
    (txn.receipt?.date_time ? formatUtcToUserTime(txn.receipt.date_time) : null) ||
    (txn.date && txn.time ? formatUtcToUserTime(`${txn.date} ${txn.time}`) : null) ||
    (txn.date ? formatUtcToUserTime(txn.date) : null) ||
    (txn.time ? formatUtcToUserTime(txn.time) : null) ||
    txn.time_formatted ||
    txn.time ||
    '--'
  );
}

/**
 * Safely resolves and formats a transaction or trip's date in user timezone (e.g. "12 Nov 2026").
 */
export function formatTxnDate(txn?: {
  created_at?: string | null;
  date?: string | null;
  time?: string | null;
  receipt?: { date_time?: string | null } | null;
} | null): string {
  if (!txn) return '--';

  const raw =
    txn.receipt?.date_time ||
    txn.created_at ||
    (txn.date && txn.time ? `${txn.date} ${txn.time}` : null) ||
    txn.date;

  return (raw ? formatUtcToUserDate(raw) : null) || '--';
}

/**
 * Safely resolves and formats a transaction or trip's date & time in user timezone (e.g. "12 Nov 2026, 4:56 PM").
 */
export function formatTxnDateTime(txn?: {
  created_at?: string | null;
  date?: string | null;
  time?: string | null;
  receipt?: { date_time?: string | null } | null;
} | null): string {
  if (!txn) return '--';

  const raw =
    txn.receipt?.date_time ||
    txn.created_at ||
    (txn.date && txn.time ? `${txn.date} ${txn.time}` : null) ||
    txn.date;

  return (raw ? formatUtcToUserDateTime(raw) : null) || '--';
}

/**
 * Formats a UTC timestamp to user's local date: e.g. "29 Oct 2026"
 */
export function formatUtcToUserDate(
  input: string | number | Date | null | undefined
): string {
  const date = parseUtcDate(input);
  if (!date) return '';

  const day = date.getDate();
  const month = MONTH_NAMES_SHORT[date.getMonth()];
  const year = date.getFullYear();

  return `${day} ${month} ${year}`;
}

export const formatSydneyToUserDate = formatUtcToUserDate;

/**
 * Formats a UTC timestamp to user's local date & time: e.g. "29 Oct 2026, 4:56 PM"
 */
export function formatUtcToUserDateTime(
  input: string | number | Date | null | undefined
): string {
  if (!input) return '';
  const date = parseUtcDate(input);
  if (!date || isNaN(date.getTime())) return '';

  const dateStr = formatUtcToUserDate(date);
  const timeStr = typeof input === 'string' && !hasTimeComponent(input) ? '' : formatUtcToUserTime(input);

  return dateStr && timeStr ? `${dateStr}, ${timeStr}` : dateStr || timeStr;
}

export const formatSydneyToUserDateTime = formatUtcToUserDateTime;

/**
 * Formats a shift time range from UTC start_at and end_at to user's local timezone:
 * e.g. "4:51 PM – 4:53 PM" (or "29 Oct 4:51 PM – 30 Oct 1:15 AM" if cross-day)
 */
export function formatUtcShiftRange(
  startInput: string | number | Date | null | undefined,
  endInput: string | number | Date | null | undefined
): string {
  const startDate = parseUtcDate(startInput);
  const endDate = parseUtcDate(endInput);

  if (!startDate && !endDate) return '';
  if (startDate && !endDate) return formatUtcToUserTime(startDate);
  if (!startDate && endDate) return formatUtcToUserTime(endDate);

  const startFormatted = formatUtcToUserTime(startDate);
  const endFormatted = formatUtcToUserTime(endDate);

  if (
    startDate!.getFullYear() !== endDate!.getFullYear() ||
    startDate!.getMonth() !== endDate!.getMonth() ||
    startDate!.getDate() !== endDate!.getDate()
  ) {
    const startDateText = formatUtcToUserDate(startDate);
    const endDateText = formatUtcToUserDate(endDate);
    return `${startDateText} ${startFormatted} – ${endDateText} ${endFormatted}`;
  }

  return `${startFormatted} – ${endFormatted}`;
}

export const formatSydneyShiftRange = formatUtcShiftRange;

/**
 * Formats a shift's UTC timestamps (start_at, end_at, time_range) into the user's local timezone.
 * Returns formatted date text (e.g. "31 Oct 2026") and time range (e.g. "2:43 PM – 2:46 PM").
 */
export function formatShiftRecordTime(record: {
  start_at?: string | null;
  end_at?: string | null;
  time_range?: string | null;
  session_date?: string | null;
}): { dateText: string; timeRangeText: string } {
  let startDate: Date | null = null;
  let endDate: Date | null = null;

  if (record.start_at) {
    startDate = parseUtcDate(record.start_at);
  }
  if (record.end_at) {
    endDate = parseUtcDate(record.end_at);
  }

  // If start_at or end_at are missing, try to parse from time_range (e.g. "2026-10-31 20:13:42 - 2026-10-31 20:16:36")
  if ((!startDate || !endDate) && record.time_range) {
    const parts = record.time_range.split(/\s+[-–—]\s+|\s+to\s+|\s*[–—]\s*/i);
    if (parts[0] && !startDate) {
      startDate = parseUtcDate(parts[0].trim());
    }
    if (parts[1] && !endDate) {
      endDate = parseUtcDate(parts[1].trim());
    }
  }

  const dateText = startDate
    ? formatUtcToUserDate(startDate)
    : record.session_date
    ? formatUtcToUserDate(record.session_date)
    : '--';

  let timeRangeText = '--';
  if (startDate && endDate) {
    timeRangeText = formatUtcShiftRange(startDate, endDate);
  } else if (startDate) {
    timeRangeText = formatUtcToUserTime(startDate);
  } else if (record.time_range) {
    timeRangeText = record.time_range;
  }

  return { dateText, timeRangeText };
}

/**
 * Safely parses various date formats treating timestamps as UTC.
 */
export const parseDate = parseUtcDate;

/**
 * Formats a UTC timestamp into standard submitted format:
 * e.g. "31 Oct 2026 6.40pm" (in user device local timezone)
 */
export function formatUtcSubmittedDate(
  input: string | number | Date | null | undefined
): string {
  const date = parseUtcDate(input);
  if (!date) return '';

  const day = date.getDate();
  const month = MONTH_NAMES_SHORT[date.getMonth()];
  const year = date.getFullYear();

  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours ? hours : 12;

  return `${day} ${month} ${year} ${hours}.${minutes}${ampm}`;
}

export const formatSydneySubmittedDate = formatUtcSubmittedDate;

/**
 * Formats a UTC timestamp explicitly into formatted UTC text:
 * e.g. "31 Oct 2026 1.10pm UTC"
 */
export function formatUtcToUtcDateTime(
  input: string | number | Date | null | undefined,
  includeSuffix = false
): string {
  const date = parseUtcDate(input);
  if (!date) return '';

  const day = date.getUTCDate();
  const month = MONTH_NAMES_SHORT[date.getUTCMonth()];
  const year = date.getUTCFullYear();

  let hours = date.getUTCHours();
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours ? hours : 12;

  return `${day} ${month} ${year} ${hours}.${minutes}${ampm}${includeSuffix ? ' UTC' : ''}`;
}

export const formatSydneyToUtcDateTime = formatUtcToUtcDateTime;

/**
 * Formats a date portion only in UTC from a UTC timestamp: "31 Oct 2026"
 */
export function formatUtcToUtcDate(
  input: string | number | Date | null | undefined
): string {
  const date = parseUtcDate(input);
  if (!date) return '';

  const day = date.getUTCDate();
  const month = MONTH_NAMES_SHORT[date.getUTCMonth()];
  const year = date.getUTCFullYear();

  return `${day} ${month} ${year}`;
}

export const formatSydneyToUtcDate = formatUtcToUtcDate;

/**
 * Formats a date/timestamp to standard user format: "26 Oct 2026 10.30pm"
 * @param input ISO string, SQL date string, timestamp, or Date
 * @returns e.g. "26 Oct 2026 10.30pm" or empty string if invalid
 */
export function formatDateTime(
  input: string | number | Date | null | undefined
): string {
  const date = parseUtcDate(input);
  if (!date) return '';

  const day = date.getDate();
  const month = MONTH_NAMES_SHORT[date.getMonth()];
  const year = date.getFullYear();

  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours ? hours : 12;

  return `${day} ${month} ${year} ${hours}.${minutes}${ampm}`;
}

/**
 * Alias for formatDateTime, specifically for submission timestamps
 * e.g. "26 Oct 2026 10.30pm"
 */
export const formatSubmittedDate = formatDateTime;

/**
 * Formats date portion only: "26 Oct 2026"
 */
export function formatDate(
  input: string | number | Date | null | undefined
): string {
  const date = parseUtcDate(input);
  if (!date) return '';

  const day = date.getDate();
  const month = MONTH_NAMES_SHORT[date.getMonth()];
  const year = date.getFullYear();

  return `${day} ${month} ${year}`;
}

/**
 * Formats time portion only: "10.30pm"
 */
export function formatTime(
  input: string | number | Date | null | undefined
): string {
  const date = parseUtcDate(input);
  if (!date) return '';

  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours ? hours : 12;

  return `${hours}.${minutes}${ampm}`;
}

/**
 * Formats a Date object to YYYY-MM-DD string
 */
export function formatDateToYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parses YYYY-MM-DD string to a Date object
 */
export function parseYMDToDate(ymd: string): Date | null {
  if (!ymd) return null;
  const parts = ymd.split('-');
  if (parts.length !== 3) return null;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  const date = new Date(y, m, d);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Formats YYYY-MM-DD to display string: e.g. "02 Nov 2026"
 */
export function formatYMDToDisplay(ymd: string): string {
  const date = parseYMDToDate(ymd);
  if (!date) return ymd;
  const day = String(date.getDate()).padStart(2, '0');
  const month = MONTH_NAMES_SHORT[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

/**
 * Formats date range for display e.g. "02 Nov 2026" or "26 Oct – 02 Nov 2026" or "All Dates"
 */
export function formatDateRangeDisplay(
  startDate: string | null | undefined,
  endDate: string | null | undefined
): string {
  if (!startDate && !endDate) return 'All Dates';
  if (startDate && !endDate) return `From ${formatYMDToDisplay(startDate)}`;
  if (!startDate && endDate) return `Up to ${formatYMDToDisplay(endDate)}`;
  if (startDate === endDate) return formatYMDToDisplay(startDate!);
  return `${formatYMDToDisplay(startDate!)} – ${formatYMDToDisplay(endDate!)}`;
}

export function getTodayYMD(): string {
  return formatDateToYMD(new Date());
}

export function getYesterdayYMD(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatDateToYMD(d);
}

export function getLast7DaysYMD(): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  return {
    startDate: formatDateToYMD(start),
    endDate: formatDateToYMD(end),
  };
}

export function getThisMonthYMD(): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), 1);
  return {
    startDate: formatDateToYMD(start),
    endDate: formatDateToYMD(end),
  };
}

/**
 * Formats a UTC timestamp into India Standard Time (IST - Asia/Kolkata):
 * e.g. "03 Nov 2026, 11:04 AM" or "03 Nov 2026, 11:04:29 AM"
 */
export function formatUtcToIndiaDateTime(
  input: string | number | Date | null | undefined,
  options: { includeSeconds?: boolean; hour12?: boolean } = {}
): string {
  const date = parseUtcDate(input);
  if (!date) return '';

  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: INDIA_TIMEZONE,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: options.includeSeconds ? '2-digit' : undefined,
      hour12: options.hour12 !== false,
    }).format(date);
  } catch {
    return formatUtcToUserDateTime(date);
  }
}

export const formatSydneyToIndiaDateTime = formatUtcToIndiaDateTime;

/**
 * Formats a UTC timestamp into India Standard Time date:
 * e.g. "03 Nov 2026"
 */
export function formatUtcToIndiaDate(
  input: string | number | Date | null | undefined
): string {
  const date = parseUtcDate(input);
  if (!date) return '';

  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: INDIA_TIMEZONE,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(date);
  } catch {
    return formatUtcToUserDate(date);
  }
}

export const formatSydneyToIndiaDate = formatUtcToIndiaDate;

/**
 * Formats a UTC timestamp into India Standard Time time:
 * e.g. "11:04 AM" or "11:04:29 AM"
 */
export function formatUtcToIndiaTime(
  input: string | number | Date | null | undefined,
  options: { includeSeconds?: boolean; hour12?: boolean } = {}
): string {
  const date = parseUtcDate(input);
  if (!date) return '';

  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: INDIA_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      second: options.includeSeconds ? '2-digit' : undefined,
      hour12: options.hour12 !== false,
    }).format(date);
  } catch {
    return formatUtcToUserTime(date);
  }
}

export const formatSydneyToIndiaTime = formatUtcToIndiaTime;

/**
 * Converts a UTC timestamp into detailed India Standard Time information.
 */
export function convertUtcToIndia(
  input: string | number | Date | null | undefined
): {
  inputTime: string;
  indiaDateTime: string;
  indiaDate: string;
  indiaTime: string;
  standard24: string;
  utcDate: Date;
} | null {
  const utcDate = parseUtcDate(input);
  if (!utcDate) return null;

  try {
    const indiaDateTime = formatUtcToIndiaDateTime(utcDate, { includeSeconds: true });
    const indiaDate = formatUtcToIndiaDate(utcDate);
    const indiaTime = formatUtcToIndiaTime(utcDate, { includeSeconds: true });

    const dtf24 = new Intl.DateTimeFormat('en-IN', {
      timeZone: INDIA_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = dtf24.formatToParts(utcDate);
    const getPart = (type: string) => parts.find((p) => p.type === type)?.value;
    const standard24 = `${getPart('year')}-${getPart('month')}-${getPart('day')} ${getPart('hour')}:${getPart('minute')}:${getPart('second')}`;

    return {
      inputTime: typeof input === 'string' ? input : String(input ?? ''),
      indiaDateTime,
      indiaDate,
      indiaTime,
      standard24,
      utcDate,
    };
  } catch {
    return null;
  }
}

export const convertSydneyToIndia = convertUtcToIndia;
