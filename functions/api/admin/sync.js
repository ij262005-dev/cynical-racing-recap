const MAX_HTML_BYTES = 25_000_000;

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost({ request, env }) {
  if (!env.SYNC_TOKEN) return json({ error: "SYNC_TOKEN secret is missing" }, 503);
  if (request.headers.get("Authorization") !== `Bearer ${env.SYNC_TOKEN}`) return json({ error: "인증에 실패했습니다." }, 401);
  if (!env.DB || !env.RACE_HTML) return json({ error: "D1 DB와 R2 RACE_HTML 연결이 필요합니다." }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON 요청을 읽을 수 없습니다." }, 400);
  }

  const now = new Date().toISOString();
  if (body.action === "start") {
    const result = await env.DB.prepare(
      "INSERT INTO sync_runs (started_at, status, message) VALUES (?, 'running', '수집 작업 시작')",
    ).bind(now).run();
    const state = await env.DB.prepare("SELECT state_value AS value FROM sync_state WHERE state_key = 'archive_cursor'").first();
    return json({ runId: result.meta.last_row_id, cursor: Math.max(0, Number(state?.value) || 0) });
  }

  const runId = Number(body.runId);
  if (!Number.isSafeInteger(runId) || runId < 1) return json({ error: "runId가 필요합니다." }, 400);

  if (body.action === "import") {
    const race = body.race;
    if (!race || !Number.isSafeInteger(Number(race.sourceId)) || Number(race.sourceId) < 1 || typeof race.htmlContent !== "string") {
      return json({ error: "경주 자료 형식이 올바르지 않습니다." }, 400);
    }
    const byteLength = new TextEncoder().encode(race.htmlContent).byteLength;
    if (byteLength === 0 || byteLength > MAX_HTML_BYTES) return json({ error: "HTML 파일이 비었거나 25MB를 초과했습니다." }, 413);
    if (!/^\d{4}\.\d{2}\.\d{2}$/.test(race.raceDate) || !Number.isSafeInteger(Number(race.raceNo)) || Number(race.raceNo) < 1) {
      return json({ error: "경주 날짜 또는 번호가 올바르지 않습니다." }, 400);
    }

    const sourceId = String(race.sourceId);
    const objectKey = `source/${sourceId}.html`;
    const contentHash = await sha256(race.htmlContent);
    const existing = await env.DB.prepare("SELECT content_hash AS contentHash FROM races WHERE source_id = ?").bind(sourceId).first();
    if (existing?.contentHash !== contentHash) {
      await env.RACE_HTML.put(objectKey, race.htmlContent, {
        httpMetadata: { contentType: "text/html; charset=utf-8" },
        customMetadata: { sourceId, contentHash },
      });
    }

    await env.DB.prepare(`
      INSERT INTO races (source_id, race_date, venue, race_no, title, corner_type, source_updated_at, synced_at, content_hash, object_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        race_date = excluded.race_date,
        venue = excluded.venue,
        race_no = excluded.race_no,
        title = excluded.title,
        corner_type = excluded.corner_type,
        source_updated_at = excluded.source_updated_at,
        synced_at = excluded.synced_at,
        content_hash = excluded.content_hash,
        object_key = excluded.object_key
    `).bind(
      sourceId,
      race.raceDate,
      String(race.venue || "미분류"),
      Number(race.raceNo),
      String(race.title || `${race.raceNo}경주`),
      race.cornerType ? String(race.cornerType) : null,
      race.sourceUpdatedAt ? String(race.sourceUpdatedAt) : null,
      now,
      contentHash,
      objectKey,
    ).run();

    const outcome = existing ? (existing.contentHash === contentHash ? "unchanged" : "updated") : "imported";
    await env.DB.prepare(`
      UPDATE sync_runs SET listed = listed + 1,
        imported = imported + ?, updated = updated + ?,
        message = '자료 확인 중'
      WHERE id = ?
    `).bind(outcome === "imported" ? 1 : 0, outcome === "updated" ? 1 : 0, runId).run();
    return json({ ok: true, outcome, sourceId });
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
