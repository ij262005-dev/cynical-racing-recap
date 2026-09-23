import { batch, chooseRaces, getPublicRace, listPublicRaces, makeImportRecord } from "./source.js";
import { fetchKraResults } from "./kra-results.js";

async function sendImport(siteUrl, token, payload) {
  const response = await fetch(`${siteUrl.replace(/\/$/, "")}/api/admin/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`복기 사이트 저장 실패 (${response.status}): ${message.slice(0, 200)}`);
  }
  return response.json();
}

async function sync(env) {
  const sourceUrl = env.CYNICAL_SOURCE_BASE_URL;
  const siteUrl = env.RECAP_SITE_BASE_URL;
  const token = env.SYNC_TOKEN;
  if (!siteUrl || !token) throw new Error("Cloudflare 환경 변수 RECAP_SITE_BASE_URL과 SYNC_TOKEN을 설정하세요.");

  const startedAt = new Date().toISOString();
  const { runId, cursor } = await sendImport(siteUrl, token, { action: "start" });
  let listed = 0;
  let imported = 0;
  let updated = 0;
  let errors = 0;
  let resultGroupsChecked = 0;
  let resultsSaved = 0;
  let nextCursor = cursor;

  try {
    if (sourceUrl) {
      try {
        const races = await listPublicRaces(sourceUrl);
        const selection = chooseRaces(races, cursor);
        nextCursor = selection.nextCursor;
        for (const group of batch(selection.selected, 4)) {
          await Promise.all(group.map(async (item) => {
            try {
              if (!Number.isSafeInteger(Number(item.id))) throw new Error("원본 경주 번호가 올바르지 않습니다.");
              const detail = await getPublicRace(sourceUrl, item.id);
              const result = await sendImport(siteUrl, token, { action: "import", runId, race: makeImportRecord(item, detail) });
              listed++;
              if (result.outcome === "imported") imported++;
              if (result.outcome === "updated") updated++;
            } catch (error) {
              errors++;
              console.error(`공개 원본 자료 ${item.id ?? "?"}: ${String(error.message || error)}`);
            }
          }));
        }
      } catch (error) {
        errors++;
        console.error(`공개 원본 목록: ${String(error.message || error)}`);
      }
    }

    if (env.KRA_SERVICE_KEY) {
      const pending = await sendImport(siteUrl, token, { action: "pending-results", runId });
      // Each call returns a whole meeting day's results. Capping each 10-minute
      // pass keeps the official data portal traffic bounded while older races rotate in.
      for (const group of (pending.groups ?? []).slice(0, 3)) {
        try {
          const results = await fetchKraResults(group, env.KRA_SERVICE_KEY);
          resultGroupsChecked++;
          if (!results.length) continue;
          const stored = await sendImport(siteUrl, token, { action: "set-results", runId, results });
          resultsSaved += Number(stored.saved) || 0;
        } catch (error) {
          errors++;
          console.error(`공식 결과 ${group.raceDate} ${group.venue}: ${String(error.message || error)}`);
        }
      }
    }

    const htmlMessage = sourceUrl
      ? `원본 확인 ${listed}건(신규 ${imported}, 수정 ${updated})`
      : "HTML은 원본 업로드 시 복기 사이트로 바로 전송";
    const resultMessage = env.KRA_SERVICE_KEY
      ? `공식 결과 ${resultsSaved}건 저장 · ${resultGroupsChecked}묶음 확인`
      : "마사회 결과 키 연결 대기";
    const summary = `${htmlMessage} · ${resultMessage}`;
    await sendImport(siteUrl, token, {
      action: "finish", runId, status: errors ? "error" : "success", listed, errors, nextCursor,
      message: errors ? `${summary} · 오류 ${errors}건` : summary,
    });
    console.log(JSON.stringify({ startedAt, listed, imported, updated, resultsSaved, resultGroupsChecked, errors }));
  } catch (error) {
    await sendImport(siteUrl, token, { action: "error", runId, message: String(error.message || error) }).catch(() => {});
    await sendImport(siteUrl, token, { action: "finish", runId, status: "error", listed, errors: errors + 1, message: String(error.message || error), nextCursor: cursor }).catch(() => {});
    throw error;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true, worker: "cynical-recap-sync" });
    if (url.pathname === "/run" && request.method === "POST") {
      if (!env.SYNC_TOKEN || request.headers.get("Authorization") !== `Bearer ${env.SYNC_TOKEN}`) {
        return Response.json({ error: "인증에 실패했습니다." }, { status: 401 });
      }
      try {
        await sync(env);
        return Response.json({ ok: true });
      } catch (error) {
        console.error(error);
        return Response.json({ ok: false, error: String(error.message || error) }, { status: 500 });
      }
    }
    return new Response("Not found", { status: 404 });
  },
  async scheduled(_controller, env, context) {
    context.waitUntil(sync(env));
  },
};
