export function isOfficeSchemaReady(
  expected: Record<string, string[]>,
  actual: { table_name: string; column_name: string }[],
): boolean {
  const found = new Set(actual.map(column => `${column.table_name}.${column.column_name}`));
  return Object.entries(expected).every(([table, columns]) =>
    columns.every(column => found.has(`${table}.${column}`)),
  );
}
