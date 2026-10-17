/**
 * Loads an HTTP response fixture from tests/fixtures/. `{{HOURS_AGO:n}}` placeholders become the
 * time n hours before now (RFC 1123 for XML feeds, ISO 8601 for JSON), so the age filters of the
 * adapters see stable, relative dates.
 */

import * as fs from "fs";
import * as path from "path";

export function loadFixture(name: string, dateFormat: "rfc1123" | "iso" = "iso"): string {
  const raw = fs.readFileSync(path.join(__dirname, name), "utf8");
  return raw.replace(/\{\{HOURS_AGO:(\d+)\}\}/g, (_, hours: string) => {
    const date = new Date(Date.now() - Number(hours) * 60 * 60 * 1000);
    return dateFormat === "rfc1123" ? date.toUTCString() : date.toISOString();
  });
}
