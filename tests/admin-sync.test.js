import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../functions/api/admin/sync.js";

function mockEnv() {
  const statements = [];
  const uploads = [];
  const env = {
    SYNC_TOKEN: "test-secret",
    DB: {
      prepare(sql) {
        return {
          bind(...values) {
            return {
              async first() {
                statements.push({ sql, values, kind: "first" });
                return null;
              },
              async run() {
                statements.push({ sql, values, kind: "run" });
                return { meta: { last_row_id: 1, changes: 1 } };
              },
              async all() {
                statements.push({ sql, values, kind: "all" });
                return { results: [] };
              },
            };
          },
        };
      },
    },
    RACE_HTML: { async put(key, value) { uploads.push({ key, value }); } },
  };
  return { env, statements, uploads };
}

test("accepts an authenticated HTML file upload and canonicalizes 부산 venue metadata", async () => {
  const { env, statements, uploads } = mockEnv();
  const form = new FormData();
  form.set("action", "upload-html");
  form.set("raceDate", "20260911");
  form.set("venue", "부경");
  form.set("raceNo", "7");
  form.set("title", "시니컬AI_부경_20260911_7경주_V233");
  form.set("htmlFile", new Blob(["<!doctype html><title>race</title>"], { type: "text/html" }), "sample.html");
  const response = await onRequestPost({
    request: new Request("https://recap.test/api/admin/sync", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
      body: form,
    }),
    env,
  });

  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.venue, "부산경남");
  assert.equal(result.raceDate, "2026.09.11");
  assert.equal(result.raceNo, 7);
  assert.equal(uploads.length, 1);
  assert.match(uploads[0].key, /manual%3A/);
  assert.ok(statements.some(({ sql, kind }) => kind === "run" && sql.includes("INSERT INTO races")));
});

test("stores KRA result rows on a matching race key", async () => {
  const { env, statements } = mockEnv();
  const response = await onRequestPost({
    request: new Request("https://recap.test/api/admin/sync", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret", "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "set-results",
        runId: 1,
        results: [{
          raceDate: "2026-09-11", venue: "부경", raceNo: 7,
          result: { source: "KRA", horses: [{ rank: "1", horseNo: "4", horseName: "시험마" }] },
        }],
      }),
    }),
    env,
  });

  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.saved, 1);
  assert.equal(result.unmatched, 0);
  const update = statements.find(({ sql }) => sql.includes("UPDATE races SET result_status"));
  assert.ok(update);
  assert.equal(update.values[1], "2026-09-11");
  assert.equal(update.values[2], "부산경남");
  assert.equal(update.values[3], 7);
});

test("rejects an upload when the authorization token is wrong", async () => {
  const { env } = mockEnv();
  const response = await onRequestPost({
    request: new Request("https://recap.test/api/admin/sync", {
      method: "POST",
      headers: { Authorization: "Bearer wrong" },
      body: "{}",
    }),
    env,
  });
  assert.equal(response.status, 401);
});
