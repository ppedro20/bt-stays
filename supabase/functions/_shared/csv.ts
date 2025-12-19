function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: string[]): string {
  const header = columns.map(escapeCsv).join(",");
  const lines = rows.map((r) => columns.map((c) => escapeCsv((r as any)[c])).join(","));
  return [header, ...lines].join("\r\n") + "\r\n";
}

