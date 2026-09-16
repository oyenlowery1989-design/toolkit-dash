export type AssetRowStatus =
  | "pending"
  | "inferring"
  | "scanning"
  | "done"
  | "error";

interface StatusRow {
  status: AssetRowStatus;
  error?: string;
}

export function cancelActiveRows<T extends StatusRow>(rows: T[]): T[] {
  return rows.map((row) =>
    row.status === "pending" ||
    row.status === "inferring" ||
    row.status === "scanning"
      ? { ...row, status: "error", error: "Scan cancelled." }
      : row,
  );
}
