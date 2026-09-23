const KRA_RESULTS_URL = "https://apis.data.go.kr/B551015/API4_3/raceResult_3";

const MEET_CODES = new Map([
  ["서울", "1"],
  ["제주", "2"],
  ["부경", "3"],
  ["부산", "3"],
  ["부산경남", "3"],
  ["영천", "4"],
]);

function cleanVenue(value) {
  const text = String(value ?? "").replace(/\s/g, "");
  if (["서울"].includes(text)) return "서울";
  if (["제주"].includes(text)) return "제주";
  if (["부경", "부산", "부산경남"].includes(text)) return "부산경남";
  if (text === "영천") return "영천";
  // A combined menu label is not enough to tell which venue held a race.
  return "";
}

function asIsoDate(value) {
  const text = String(value ?? "").trim();
  if (/^\d{4}\.\d{2}\.\d{2}$/.test(text)) return text.replaceAll(".", "-");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return "";
}

function readField(item, aliases) {
  for (const key of aliases) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function itemRows(payload) {
  const response = payload?.response ?? payload;
  const header = response?.header;
  const resultCode = String(header?.resultCode ?? header?.result_code ?? "");
  if (resultCode && !["00", "0000"].includes(resultCode)) {
    const message = header?.resultMsg ?? header?.result_msg ?? "한국마사회 결과 API 오류";
    throw new Error(`한국마사회 API 응답 오류 (${resultCode}): ${String(message).slice(0, 160)}`);
  }

  const candidates = [
    response?.body?.items?.item,
    response?.body?.items,
    response?.items?.item,
    response?.items,
    response?.body?.item,
    response?.item,
  ];
  const found = candidates.find((value) => value !== undefined && value !== null);
  if (Array.isArray(found)) return found;
  if (found && typeof found === "object") return [found];
  return [];
}

export function normalizeKraRows(payload, group, fetchedAt = new Date().toISOString()) {
  const venue = cleanVenue(group.venue);
  const raceDate = asIsoDate(group.raceDate);
  const meet = MEET_CODES.get(String(group.venue ?? "").replace(/\s/g, ""));
  if (!venue || !raceDate || !meet) throw new Error("경주 날짜 또는 경마장을 확인할 수 없습니다.");

  const allowedRaceNos = new Set((group.raceNos ?? []).map(Number));
  const grouped = new Map();
  for (const sourceRow of itemRows(payload)) {
    const rowDate = asIsoDate(readField(sourceRow, ["rc_date", "rcDate", "race_date", "raceDate", "RACE_DT", "raceDt"]) || raceDate);
    const raceNo = Number(readField(sourceRow, ["rc_no", "rcNo", "race_no", "raceNo", "rno", "raceNumber", "경주번호"]));
    if (rowDate !== raceDate || !Number.isSafeInteger(raceNo) || raceNo < 1 || raceNo > 20) continue;
    if (allowedRaceNos.size && !allowedRaceNos.has(raceNo)) continue;

    const normalized = {
      rank: readField(sourceRow, ["ord", "rank", "rc_rank", "rankNo", "finish", "착순", "순위"]),
      horseNo: readField(sourceRow, ["chul_no", "chulNo", "horseNo", "hr_no", "마번", "출주번호"]),
      horseName: readField(sourceRow, ["hr_name", "hrName", "horseName", "hr_nm", "마명"]),
      jockey: readField(sourceRow, ["jk_name", "jkName", "jockey", "jockeyName", "기수명"]),
      trainer: readField(sourceRow, ["tr_name", "trName", "trainer", "trainerName", "조교사명"]),
      time: readField(sourceRow, ["rc_time", "rcTime", "time", "finishTime", "경주기록"]),
      margin: readField(sourceRow, ["diff", "margin", "diff_unit", "착차"]),
      horseWeight: readField(sourceRow, ["hr_weight", "hrWeight", "horseWeight", "마체중"]),
      raw: sourceRow,
    };
    if (!grouped.has(raceNo)) grouped.set(raceNo, []);
    grouped.get(raceNo).push(normalized);
  }

  return [...grouped.entries()].map(([raceNo, horses]) => ({
    raceDate,
    venue,
    raceNo,
    result: {
      source: "한국마사회 경주기록 정보",
      sourceUrl: "https://data.go.kr/data/15058305/openapi.do",
      fetchedAt,
      meet: Number(meet),
      raceDate,
      raceNo,
      horses: horses.sort((a, b) => {
        const aRank = Number(a.rank);
        const bRank = Number(b.rank);
        if (Number.isFinite(aRank) && Number.isFinite(bRank)) return aRank - bRank;
        return String(a.rank).localeCompare(String(b.rank), "ko");
      }),
    },
  }));
}

export async function fetchKraResults(group, serviceKey) {
  if (!serviceKey) throw new Error("KRA_SERVICE_KEY가 설정되지 않았습니다.");
  const venue = cleanVenue(group.venue);
  const meet = MEET_CODES.get(String(group.venue ?? "").replace(/\s/g, ""));
  const isoDate = asIsoDate(group.raceDate);
  if (!venue || !meet || !isoDate) throw new Error("한국마사회 결과 조회 조건이 올바르지 않습니다.");

  const url = new URL(KRA_RESULTS_URL);
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("meet", meet);
  url.searchParams.set("rc_date", isoDate.replaceAll("-", ""));
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "2000");
  url.searchParams.set("_type", "json");

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`한국마사회 결과 조회 실패 (HTTP ${response.status})`);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("한국마사회 결과 응답이 JSON이 아닙니다.");
  }
  return normalizeKraRows(payload, group);
}

export function kraMeetCode(venue) {
  return MEET_CODES.get(String(venue ?? "").replace(/\s/g, "")) ?? null;
}
