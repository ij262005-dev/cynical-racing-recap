import test from "node:test";
import assert from "node:assert/strict";
import { batch, chooseRaces, listPublicRaces, makeImportRecord } from "../src/source.js";

test("reads a batched tRPC list response from the existing public API", async (t) => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/api\/trpc\/race\.list\?batch=1&input=/);
    return Response.json([{ result: { data: { json: [{ id: 21, raceDate: "2026.09.23", venue: "서울", raceNo: 2, title: "서울 2경주" }] } } }]);
  };
  t.after(() => { globalThis.fetch = oldFetch; });

  assert.deepEqual(await listPublicRaces("https://example.test/"), [
    { id: 21, raceDate: "2026.09.23", venue: "서울", raceNo: 2, title: "서울 2경주" },
  ]);
});

test("preserves date, venue, title, and original HTML from the source record", () => {
  const row = makeImportRecord(
    { id: 21, raceDate: "2026.09.23", venue: "서울", raceNo: 2, title: "서울 2경주", createdAt: "2026-09-23T07:00:00Z" },
    { htmlContent: "<html>원본</html>", updatedAt: "2026-09-23T07:05:00Z" },
  );
  assert.equal(row.sourceId, 21);
  assert.equal(row.raceDate, "2026.09.23");
  assert.equal(row.venue, "서울");
  assert.equal(row.htmlContent, "<html>원본</html>");
  assert.equal(row.sourceUpdatedAt, "2026-09-23T07:05:00Z");
});

test("divides source records into bounded request batches", () => {
  assert.deepEqual(batch([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("checks the newest records every run and rotates through the older archive", () => {
  const items = Array.from({ length: 35 }, (_, index) => ({ id: index + 1 }));
  const first = chooseRaces(items, 0);
  assert.deepEqual(first.selected.slice(0, 10).map((item) => item.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(first.selected.length, 20);
  assert.equal(first.nextCursor, 10);
  const second = chooseRaces(items, first.nextCursor);
  assert.deepEqual(second.selected.slice(10).map((item) => item.id), [21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
});

test("keeps only the latest public analysis for each race", () => {
  const rows = [
    { id: 10, raceDate: "2026.09.11", venue: "부산경남", raceNo: 7, version: "V230", createdAt: "2026-09-10T22:00:00Z" },
    { id: 11, raceDate: "2026.09.11", venue: "부경", raceNo: 7, version: "V233", createdAt: "2026-09-10T23:00:00Z" },
    { id: 12, raceDate: "2026.09.11", venue: "부경", raceNo: 8, version: "V233", createdAt: "2026-09-10T23:05:00Z" },
  ];
  const result = chooseRaces(rows, 0);
  assert.deepEqual(result.selected.map((item) => item.id), [11, 12]);
});
