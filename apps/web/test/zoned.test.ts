// Time-zone helpers behind the queue calendar.
import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, dayKey, isoWeekday, moveToDay, weekStart, zonedParts, zonedToIso } from "../src/lib/zoned";

test("day keys and wall-clock times follow the Settings time zone, not UTC", () => {
  const iso = "2026-11-26T02:30:00.000Z"; // still Nov 25 in New York, already Nov 26 in Kolkata
  assert.equal(dayKey(iso, "America/New_York"), "2026-11-25");
  assert.equal(dayKey(iso, "Asia/Kolkata"), "2026-11-26");
  assert.deepEqual(zonedParts(iso, "Asia/Kolkata"), { y: 2026, m: 11, d: 26, h: 8, min: 0 });
});

test("wall-clock time to instant, including daylight-saving days", () => {
  assert.equal(zonedToIso("2026-11-26", 9, 0, "Asia/Kolkata"), "2026-11-26T03:30:00.000Z");
  assert.equal(zonedToIso("2026-07-01", 9, 0, "Europe/London"), "2026-07-01T08:00:00.000Z"); // BST
  assert.equal(zonedToIso("2026-12-01", 9, 0, "Europe/London"), "2026-12-01T09:00:00.000Z"); // GMT
  // The US switches back on Nov 1, 2026: 09:00 that day is EST.
  assert.equal(zonedToIso("2026-11-01", 9, 0, "America/New_York"), "2026-11-01T14:00:00.000Z");
});

test("calendar math: weekdays, week start, adding days across months", () => {
  assert.equal(isoWeekday("2026-11-26"), 4); // Thursday
  assert.equal(isoWeekday("2026-11-29"), 7); // Sunday
  assert.equal(weekStart("2026-11-29"), "2026-11-23");
  assert.equal(weekStart("2026-11-23"), "2026-11-23");
  assert.equal(addDays("2026-11-30", 2), "2026-12-02");
  assert.equal(addDays("2027-01-01", -1), "2026-12-31");
});

test("moving a post to another day keeps its local time", () => {
  // 18:15 in Kolkata on Nov 26 -> 18:15 in Kolkata on Dec 3.
  const at = zonedToIso("2026-11-26", 18, 15, "Asia/Kolkata");
  const moved = moveToDay(at, "2026-12-03", "Asia/Kolkata");
  assert.deepEqual(zonedParts(moved, "Asia/Kolkata"), { y: 2026, m: 12, d: 3, h: 18, min: 15 });
  // Across a DST change the local time stays 09:00.
  const ny = zonedToIso("2026-10-30", 9, 0, "America/New_York");
  assert.equal(zonedParts(moveToDay(ny, "2026-11-02", "America/New_York"), "America/New_York").h, 9);
});
