export async function onRequestGet({ env }) {
  if (!env.DB) return Response.json({ ready: false, message: "D1 binding DB is missing" }, { status: 503 });

  try {
    const [count, latest] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS total FROM races").first(),
      env.DB.prepare(
        "SELECT started_at AS startedAt, finished_at AS finishedAt, status, listed, imported, updated, errors, message FROM sync_runs ORDER BY id DESC LIMIT 1",
      ).first(),
    ]);

    return Response.json({
      ready: true,
      count: Number(count?.total ?? 0),
      lastSyncAt: latest?.finishedAt ?? null,
      sync: latest ?? null,
      intervalMinutes: 10,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ ready: false, message: "D1 tables are not initialized", detail: String(error) }, { status: 503 });
  }
}
