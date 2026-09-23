export async function onRequestGet({ params, env }) {
  if (!env.DB) return Response.json({ message: "D1 binding DB is missing" }, { status: 503 });
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id < 1) return Response.json({ message: "잘못된 자료 번호입니다." }, { status: 400 });

  const race = await env.DB.prepare(
    "SELECT id, race_date AS raceDate, venue, race_no AS raceNo, title, corner_type AS cornerType, synced_at AS syncedAt, result_status AS resultStatus, object_key AS objectKey FROM races WHERE id = ?",
  ).bind(id).first();
  if (!race) return Response.json({ message: "자료를 찾을 수 없습니다." }, { status: 404 });
  const { objectKey, ...publicRace } = race;
  return Response.json(publicRace, { headers: { "Cache-Control": "public, max-age=60" } });
}
