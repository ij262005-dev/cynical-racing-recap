function queryUrl(baseUrl, procedure, input) {
  const batchInput = encodeURIComponent(JSON.stringify({ 0: { json: input } }));
  return `${baseUrl.replace(/\/$/, "")}/api/trpc/${procedure}?batch=1&input=${batchInput}`;
}

function unwrapTrpc(payload) {
  const item = Array.isArray(payload) ? payload[0] : (payload?.["0"] ?? payload);
  if (item?.error) throw new Error(item.error.json?.message || item.error.message || "원본 사이트에서 오류를 돌려줬습니다.");
  return item?.result?.data?.json ?? item?.result?.data ?? item?.data?.json ?? item?.data ?? item;
}

async function trpcGet(baseUrl, procedure, input) {
  const response = await fetch(queryUrl(baseUrl, procedure, input), {
    headers: { Accept: "application/json", "User-Agent": "CynicalRecapSync/1.0" },
  });
  if (!response.ok) throw new Error(`${procedure} 요청 실패 (${response.status})`);
  return unwrapTrpc(await response.json());
}

export async function listPublicRaces(baseUrl) {
  const result = await trpcGet(baseUrl, "race.list", null);
  if (!Array.isArray(result)) throw new Error("원본 사이트의 경주 목록 형식을 확인할 수 없습니다.");
  return result;
}

export async function getPublicRace(baseUrl, id) {
  const result = await trpcGet(baseUrl, "race.get", { id: Number(id) });
  if (!result || typeof result.htmlContent !== "string") throw new Error(`경주 ${id}의 HTML 내용이 없습니다.`);
  return result;
}

export function makeImportRecord(item, detail) {
  return {
    sourceId: Number(item.id),
    raceDate: detail.raceDate || item.raceDate,
    venue: detail.venue || item.venue,
    raceNo: Number(detail.raceNo || item.raceNo),
    title: detail.title || item.title,
    cornerType: detail.cornerType || item.cornerType || null,
    sourceUpdatedAt: detail.updatedAt || item.updatedAt || item.createdAt || null,
    htmlContent: detail.htmlContent,
  };
}

export function batch(items, size) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

export function chooseRaces(items, cursor, headCount = 10, rotatingCount = 10) {
  if (items.length <= headCount) return { selected: items, nextCursor: 0 };
  const head = items.slice(0, headCount);
  const archive = items.slice(headCount);
  const start = Math.max(0, Number(cursor) || 0) % archive.length;
  const count = Math.min(rotatingCount, archive.length);
  const rotating = Array.from({ length: count }, (_, index) => archive[(start + index) % archive.length]);
  const selected = [...new Map([...head, ...rotating].map((item) => [String(item.id), item])).values()];
  return { selected, nextCursor: (start + count) % archive.length };
}
