export function csvCell(value: string | number) {
  const text = typeof value === "string" && /^[\s\u0000-\u0020\u007f]*[=+\-@]/u.test(value)
    ? `'${value}`
    : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function createCsv(rows: Array<Array<string | number>>) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
