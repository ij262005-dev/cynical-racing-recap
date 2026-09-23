const MAX_HTML_BYTES = 25_000_000;
const MAX_RESULT_BYTES = 5_000_000;

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizedDate(value) {
  const text = String(value ?? "").trim();
  let dotted;
  if (/^\d{4}\.\d{2}\.\d{2}$/.test(text)) dotted = text;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(text)) dotted = text.replaceAll("-", ".");
  else if (/^\d{8}$/.test(text)) dotted = `${text.slice(0, 4)}.${text.slice(4, 6)}.${text.slice(6, 8)}`;
  else return "";
  const iso = dotted.replaceAll(".", "-");
  const parsed = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? dotted : "";
}

function canonicalVenue(value) {
  const raw = String(value ?? "").trim();
  const compact = raw.replace(/\s/g, "");
  if (compact === "서울") return "서울";
  if (compact === "제주") return "제주";
  if (["부경", "부산", "부산경남"].includes(compact)) return "부산경남";
  if (compact === "영천") return "영천";
  // A combined menu label does not identify the venue of a specific race.
  return raw || "미분류";
}

async function storeRace(env, race, now, sourceIdOverride) {
  if (!race || typeof race.htmlContent !== "string") throw new Error("경주 HTML 내용이 없습니다.");
  const byteLength = new TextEncoder().encode(race.htmlContent).byteLength;
  if (byteLength === 0 || byteLength > MAX_HTML_BYTES) throw new Error("HTML 파일이 비었거나 25MB를 초과했습니다.");

  const raceDate = normalizedDate(race.raceDate);
  const raceNo = Number(race.raceNo);
  if (!raceDate || !Number.isSafeInteger(raceNo) || raceNo < 1 || raceNo > 20) {
    throw new Error("경주 날짜 또는 번호가 올바르지 않습니다.");
  }
  const venue = canonicalVenue(race.venue);
  const sourceId = String(sourceIdOverride ?? race.sourceId ?? "");
  if (!sourceId || sourceId.length > 180) throw new Error("경주 자료 식별번호가 올바르지 않습니다.");

  const objectKey = `source/${encodeURIComponent(sourceId)}.html`;
  const contentHash = await sha256(race.htmlContent);
  const existing = await env.DB.prepare(
    "SELECT id, content_hash AS contentHash, object_key AS objectKey FROM races WHERE source_id = ? OR (race_date = ? AND venue = ? AND race_no = ?) ORDER BY CASE WHEN source_id = ? THEN 0 ELSE 1 END LIMIT 1",
  ).bind(sourceId, raceDate, venue, raceNo, sourceId).first();

  if (!existing || existing.contentHash !== contentHash || existing.objectKey !== objectKey) {
    await env.RACE_HTML.put(objectKey, race.htmlContent, {
      httpMetadata: { contentType: "text/html; charset=utf-8" },
      customMetadata: { sourceId, contentHash },
    });
  }

  if (existing) {
    await env.DB.prepare(`
      UPDATE races SET source_id = ?, race_date = ?, venue = ?, race_no = ?, title = ?, corner_type = ?,
        source_updated_at = ?, synced_at = ?, content_hash = ?, object_key = ?
      WHERE id = ?
    `).bind(
      sourceId, raceDate, venue, raceNo,
      String(race.title || `${raceNo}경주`),
      race.cornerType ? String(race.cornerType) : null,
      race.sourceUpdatedAt ? String(race.sourceUpdatedAt) : null,
      now, contentHash, objectKey, existing.id,
    ).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO races (source_id, race_date, venue, race_no, title, corner_type, source_updated_at, synced_at, content_hash, object_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      sourceId, raceDate, venue, raceNo,
      String(race.title || `${raceNo}경주`),
      race.cornerType ? String(race.cornerType) : null,
      race.sourceUpdatedAt ? String(race.sourceUpdatedAt) : null,
      now, contentHash, objectKey,
    ).run();
  }

  return {
    sourceId,
    outcome: !existing ? "imported" : existing.contentHash === contentHash ? "unchanged" : "updated",
  };
}

function kstToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

export async function onRequestPost({ request, env }) {
  if (!env.SYNC_TOKEN) return json({ error: "SYNC_TOKEN secret is missing" }, 503);
  if (request.headers.get("Authorization") !== `Bearer ${env.SYNC_TOKEN}`) return json({ error: "인증에 실패했습니다." }, 401);
  if (!env.DB || !env.RACE_HTML) return json({ error: "D1 DB와 R2 RACE_HTML 연결이 필요합니다." }, 503);

  let body;
  const contentType = request.headers.get("Content-Type") || "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("htmlFile");
      if (!file || typeof file.text !== "function") return json({ error: "HTML 파일을 선택하세요." }, 400);
      body = {
        action: form.get("action"),
        race: {
          raceDate: form.get("raceDate"),
          venue: form.get("venue"),
          raceNo: form.get("raceNo"),
          title: form.get("title"),
          cornerType: form.get("cornerType"),
          htmlContent: await file.text(),
        },
      };
    } else {
      body = await request.json();
    }
  } catch {
    return json({ error: "요청 내용을 읽을 수 없습니다." }, 400);
  }

  const now = new Date().toISOString();
  if (body.action === "start") {
    const result = await env.DB.prepare(
      "INSERT INTO sync_runs (started_at, status, message) VALUES (?, 'running', '수집 작업 시작')",
    ).bind(now).run();
    const state = await env.DB.prepare("SELECT state_value AS value FROM sync_state WHERE state_key = 'archive_cursor'").first();
    return json({ runId: result.meta.last_row_id, cursor: Math.max(0, Number(state?.value) || 0) });
  }

  if (body.action === "upload-html") {
    const race = body.race;
    if (!race || typeof race.htmlContent !== "string") return json({ error: "HTML 자료 형식이 올바르지 않습니다." }, 400);
    const date = normalizedDate(race.raceDate);
    const venue = canonicalVenue(race.venue);
    const raceNo = Number(race.raceNo);
    if (!date || !["서울", "제주", "부산경남", "영천"].includes(venue) || !Number.isSafeInteger(raceNo) || raceNo < 1 || raceNo > 20) {
      return json({ error: "파일 이름의 경주일·경마장·경주번호를 확인하세요." }, 400);
    }
    const uploaded = {
      ...race,
      raceDate: date,
      venue,
      raceNo,
      title: race.title || `${venue}_${date.replaceAll(".", "")}_${raceNo}경주`,
    };
    try {
      const sourceId = race.sourceId && /^\d+$/.test(String(race.sourceId))
        ? String(race.sourceId)
        : `manual:${date}:${venue}:${raceNo}`;
      const saved = await storeRace(env, uploaded, now, sourceId);
      return json({ ok: true, ...saved, raceDate: date, venue, raceNo });
    } catch (error) {
      return json({ error: String(error.message || error) }, 400);
    }
  }

  const runId = Number(body.runId);
  if (!Number.isSafeInteger(runId) || runId < 1) return json({ error: "runId가 필요합니다." }, 400);

  if (body.action === "import") {
    const race = body.race;
    if (!race || !Number.isSafeInteger(Number(race.sourceId)) || Number(race.sourceId) < 1 || typeof race.htmlContent !== "string") {
      return json({ error: "경주 자료 형식이 올바르지 않습니다." }, 400);
    }
    let saved;
    try {
      saved = await storeRace(env, race, now);
    } catch (error) {
      return json({ error: String(error.message || error) }, 400);
    }
    await env.DB.prepare(`
      UPDATE sync_runs SET listed = listed + 1,
        imported = imported + ?, updated = updated + ?,
        message = '자료 확인 중'
      WHERE id = ?
    `).bind(saved.outcome === "imported" ? 1 : 0, saved.outcome === "updated" ? 1 : 0, runId).run();
    return json({ ok: true, ...saved });
  }

  if (body.action === "pending-results") {
    const rows = await env.DB.prepare(`
      SELECT race_date AS raceDate, venue, race_no AS raceNo
      FROM races
      WHERE result_status = 'pending' AND replace(race_date, '.', '-') <= ?
      ORDER BY race_date DESC, venue, race_no
      LIMIT 600
    `).bind(kstToday()).all();
    const groups = new Map();
    for (const row of rows.results ?? []) {
      if (!["서울", "제주", "부산경남", "부경", "부산", "영천"].includes(row.venue)) continue;
      const key = `${row.raceDate}|${row.venue}`;
      if (!groups.has(key)) groups.set(key, { raceDate: row.raceDate, venue: row.venue, raceNos: [] });
      groups.get(key).raceNos.push(Number(row.raceNo));
    }
    return json({ groups: [...groups.values()] });
  }

  if (body.action === "set-results") {
    if (!Array.isArray(body.results) || body.results.length > 300) return json({ error: "경주 결과 묶음이 올바르지 않습니다." }, 400);
    const resultsBytes = new TextEncoder().encode(JSON.stringify(body.results)).byteLength;
    if (resultsBytes > MAX_RESULT_BYTES) return json({ error: "경주 결과가 5MB를 초과했습니다." }, 413);
    let saved = 0;
    let unmatched = 0;
    for (const item of body.results) {
      const raceDate = normalizedDate(item?.raceDate);
      const venue = canonicalVenue(item?.venue);
      const raceNo = Number(item?.raceNo);
      const result = item?.result;
      if (!raceDate || !["서울", "제주", "부산경남", "영천"].includes(venue) || !Number.isSafeInteger(raceNo) || raceNo < 1 || raceNo > 20 || !Array.isArray(result?.horses) || result.horses.length === 0) {
        unmatched++;
        continue;
      }
      const update = await env.DB.prepare(`
        UPDATE races SET result_status = 'ready', result_json = ?
        WHERE replace(race_date, '.', '-') = ? AND venue = ? AND race_no = ?
      `).bind(JSON.stringify(result), raceDate.replaceAll(".", "-"), venue, raceNo).run();
      if (Number(update.meta?.changes || 0) > 0) saved++;
      else unmatched++;
    }
    return json({ ok: true, saved, unmatched });
  }

  if (body.action === "error") {
    const message = String(body.message || "수집 오류").slice(0, 500);
    await env.DB.prepare("UPDATE sync_runs SET errors = errors + 1, message = ? WHERE id = ?").bind(message, runId).run();
    return json({ ok: true });
  }

  if (body.action === "finish") {
    const status = body.status === "error" ? "error" : "success";
    const listed = Math.max(0, Number(body.listed) || 0);
    const errors = Math.max(0, Number(body.errors) || 0);
    const nextCursor = Math.max(0, Number(body.nextCursor) || 0);
    const message = String(body.message || (status === "success" ? "수집 완료" : "일부 자료 확인 실패")).slice(0, 500);
    await env.DB.prepare("UPDATE sync_runs SET finished_at = ?, status = ?, listed = MAX(listed, ?), errors = MAX(errors, ?), message = ? WHERE id = ?")
      .bind(now, status, listed, errors, message, runId).run();
    await env.DB.prepare("INSERT INTO sync_state (state_key, state_value) VALUES ('archive_cursor', ?) ON CONFLICT(state_key) DO UPDATE SET state_value = excluded.state_value")
      .bind(String(nextCursor)).run();
    return json({ ok: true });
  }

  return json({ error: "지원하지 않는 action입니다." }, 400);
}
