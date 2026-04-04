/** Round to at most 1 decimal; show integer when possible */
export function fmtTotal(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Split items into rows of up to 2 columns, each column holding chunkSize items */
export function chunkToRows<T>(items: T[], chunkSize: number): T[][][] {
  const cols: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    cols.push(items.slice(i, i + chunkSize));
  }
  const rows: T[][][] = [];
  for (let i = 0; i < cols.length; i += 2) {
    rows.push(cols.slice(i, i + 2));
  }
  return rows;
}

/**
 * Format arrival_time (ISO string) to HH:mm for queue badges.
 * Returns empty string if time is falsy or unparseable.
 */
export function formatQueueTime(t?: string): string {
  if (!t) return '';
  try {
    const d = new Date(t);
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '';
  }
}

/**
 * Format arrival_time (ISO string) to HH:mm:ss for take-number success messages.
 * Returns empty string if time is falsy or unparseable.
 */
export function formatQueueTimeFull(t?: string): string {
  if (!t) return '';
  try {
    const d = new Date(t);
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch {
    return '';
  }
}

const DIGIT_MAP: Record<string, string> = {
  '0': '零', '1': '一', '2': '二', '3': '三', '4': '四',
  '5': '五', '6': '六', '7': '七', '8': '八', '9': '九',
};

/**
 * Convert digit runs of 3+ digits to individual Chinese characters for TTS.
 * Digit runs of 1-2 digits are left as-is for natural reading by the speech engine
 * ("5" → "五", "12" → "十二"). Runs of 3+ digits are spelled out digit-by-digit
 * ("101" → "一零一", "1234" → "一二三四").
 */
export function buildRoomSpeechText(room: string): string {
  return room.replace(/\d+/g, match =>
    match.length >= 3 ? match.split('').map(d => DIGIT_MAP[d] ?? d).join('') : match
  );
}

/**
 * Format room name for display.
 * - If room is undefined or empty, returns "诊室"
 * - If room is a pure number (e.g., "1", "123"), prepends "诊室" -> "诊室1", "诊室123"
 * - If room already contains "诊室", returns as-is
 * - Otherwise returns the original room name
 */
export function formatRoom(room: string | undefined): string {
  if (!room) return '诊室';
  const trimmed = room.trim();
  if (!trimmed) return '诊室';
  if (/^\d+$/.test(trimmed)) return `诊室${trimmed}`;
  if (trimmed.includes('诊室')) return trimmed;
  return trimmed;
}
