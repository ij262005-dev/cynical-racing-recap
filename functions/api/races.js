export async function onRequestGet({ request, env }) {
  if (!env.DB) return Response.json({ races: [], message: "D1 binding DB is missing" }, { status: 503 });

  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const venue = url.searchParams.get("venue");
  const day = url.searchParams.get("day");

  const where = [];
  const values = [];
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    where.push("replace(race_date, '.', '-') = ?");
    values.push(date);
  }
  if (venue && venue !== "전체") {
    const canonical = ["부경", "부산"].includes(venue) ? "부산경남" : venue;
    where.push("venue = ?");
    values.push(canonical);
  }
  if (day && /^[0-6]$/.test(day)) {
    where.push("CAST(strftime('%w', replace(race_date, '.', '-')) AS TEXT) = ?");
    values.push(day);
  }

  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const result = await env.DB.prepare(
    `SELECT id, race_date AS raceDate, venue, race_no AS raceNo, title, corner_type AS cornerType, synced_at AS syncedAt, result_status AS resultStatus FROM races ${clause} ORDER BY race_date DESC, venue, race_no LIMIT 500`,
  ).bind(...values).all();

  return Response.json({ races: result.results ?? [] }, {
    headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" },
  });
}
