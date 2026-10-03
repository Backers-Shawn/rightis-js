/** Left-aligned columns separated by two spaces. */
export function table(rows: string[][]): string[] {
  const widths: number[] = [];
  for (const row of rows) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)));
  return rows.map((row) =>
    row
      .map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]!)))
      .join('  ')
      .trimEnd(),
  );
}
