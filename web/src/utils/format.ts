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
