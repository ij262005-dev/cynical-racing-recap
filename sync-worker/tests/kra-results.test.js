import test from "node:test";
import assert from "node:assert/strict";
import { fetchKraResults, kraMeetCode, normalizeKraRows } from "../src/kra-results.js";

test("maps KRA venue aliases and joins the returned horses to the exact date and race", () => {
  const groups = normalizeKraRows({
    response: {
      header: { resultCode: "00" },
      body: { items: { item: [
        { rc_date: "20260911", rc_no: 7, ord: "2", chul_no: 4, hr_name: "바다의왕", jk_name: "홍길동", rc_time: "1:25.4" },
        { rc_date: "20260911", rc_no: 7, ord: "1", chul_no: 1, hr_name: "부산별빛", jk_name: "김기수", rc_time: "1:24.1" },
        { rc_date: "20260911", rc_no: 8, ord: "1", chul_no: 2, hr_name: "다른경주", jk_name: "기수", rc_time: "1:20.0" },
        { rc_date: "20260912", rc_no: 7, ord: "1", chul_no: 3, hr_name: "다른날", jk_name: "기수", rc_time: "1:20.0" },
      ] } },
    },
  }, { raceDate: "2026.09.11", venue: "부경", raceNos: [7] }, "2026-09-11T00:00:00.000Z");

  assert.equal(kraMeetCode("부경"), "3");
  assert.equal(kraMeetCode("영천"), "4");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].venue, "부산경남");
  assert.equal(groups[0].raceDate, "2026-09-11");
  assert.equal(groups[0].raceNo, 7);
  assert.deepEqual(groups[0].result.horses.map((horse) => horse.horseName), ["부산별빛", "바다의왕"]);
});

test("rejects a combined venue label instead of guessing 부산 or 영천", () => {
  assert.throws(() => normalizeKraRows({}, { raceDate: "2026.09.11", venue: "부산경남 · 영천", raceNos: [1] }), /경주 날짜 또는 경마장을/);
});

test("calls the official results operation with the selected track and date", async (t) => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, "https://apis.data.go.kr/B551015/API4_3/raceResult_3");
    assert.equal(url.searchParams.get("meet"), "3");
    assert.equal(url.searchParams.get("rc_date"), "20260911");
    assert.equal(url.searchParams.get("numOfRows"), "2000");
    assert.equal(url.searchParams.get("_type"), "json");
    assert.equal(url.searchParams.get("serviceKey"), "private-test-key");
    return Response.json({ response: { header: { resultCode: "00" }, body: { items: { item: [
      { rc_date: "20260911", rc_no: 7, ord: 1, chul_no: 4, hr_name: "결과말" },
    ] } } } });
  };
  t.after(() => { globalThis.fetch = oldFetch; });

  const result = await fetchKraResults({ raceDate: "2026.09.11", venue: "부산경남", raceNos: [7] }, "private-test-key");
  assert.equal(result[0].result.horses[0].horseName, "결과말");
});
