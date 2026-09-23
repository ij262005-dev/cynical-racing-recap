export async function onRequestGet({ params, env }) {
  if (!env.DB || !env.RACE_HTML) return new Response("저장소 연결이 아직 설정되지 않았습니다.", { status: 503 });
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id < 1) return new Response("잘못된 자료 번호입니다.", { status: 400 });

  const race = await env.DB.prepare("SELECT object_key AS objectKey FROM races WHERE id = ?").bind(id).first();
  if (!race) return new Response("자료를 찾을 수 없습니다.", { status: 404 });
  const object = await env.RACE_HTML.get(race.objectKey);
  if (!object) return new Response("HTML 파일을 찾을 수 없습니다.", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Content-Security-Policy", "sandbox; default-src 'none'; img-src data: https:; style-src 'unsafe-inline' https:; font-src data: https:; frame-ancestors 'self'");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cache-Control", "private, max-age=60");
  return new Response(object.body, { headers });
}
