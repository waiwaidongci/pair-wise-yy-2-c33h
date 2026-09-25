// 结算档案存储：负责 JSON 档案读写、赛事奖金方案登记、结算版本留档。
// 每场赛事同一时刻只有一个 active 结算版本，旧版本置为 archived 留档，永不删除。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "pigeons.json");

const seed = {
  pigeons: [
    { ringNo: "CHN-2026-001", owner: "北岸棚", fatherRing: "CHN-2022-188", motherRing: "CHN-2023-512", color: "灰", loft: "北岸A棚", vaccines: [{ date: "2026-04-01", name: "新城疫" }], transfers: [{ date: "2026-04-15", from: "育种棚", to: "北岸棚" }], races: [{ date: "2026-06-01", event: "120公里训放", distance: 120, returnTime: "10:42", rank: 18 }] },
    { ringNo: "CHN-2022-188", owner: "育种棚", fatherRing: "", motherRing: "", color: "雨点", loft: "种鸽棚", vaccines: [], transfers: [], races: [] },
    { ringNo: "CHN-2023-512", owner: "育种棚", fatherRing: "", motherRing: "", color: "红轮", loft: "种鸽棚", vaccines: [], transfers: [], races: [] }
  ],
  prizeEvents: [],
  settlements: []
};

export async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  if (!Array.isArray(db.prizeEvents)) db.prizeEvents = [];
  if (!Array.isArray(db.settlements)) db.settlements = [];
  return db;
}

export async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// 登记一场赛事的奖金方案：赛事名 + 放飞日唯一，名次不重复，金额必须为正。
export function createPrizeEvent(db, input) {
  const event = String(input.event || "").trim();
  const releaseDate = String(input.releaseDate || "").trim();
  if (!event) throw new Error("赛事名称不能为空");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) throw new Error("放飞日期格式应为 YYYY-MM-DD");
  const prizes = (Array.isArray(input.prizes) ? input.prizes : []).map(item => ({ rank: Number(item.rank), amount: Number(item.amount) }));
  if (!prizes.length) throw new Error("至少设置一个名次奖金");
  const ranks = new Set();
  for (const prize of prizes) {
    if (!Number.isInteger(prize.rank) || prize.rank <= 0) throw new Error("名次必须是正整数");
    if (!Number.isFinite(prize.amount) || prize.amount <= 0) throw new Error("奖金金额必须大于 0");
    if (ranks.has(prize.rank)) throw new Error(`第 ${prize.rank} 名奖金重复设置`);
    ranks.add(prize.rank);
  }
  if (db.prizeEvents.some(item => item.event === event && item.releaseDate === releaseDate)) {
    throw new Error("该赛事和放飞日已登记奖金方案");
  }
  const prizeEvent = { id: newId("evt"), event, releaseDate, prizes: prizes.sort((a, b) => a.rank - b.rank), createdAt: new Date().toISOString() };
  db.prizeEvents.push(prizeEvent);
  return prizeEvent;
}

export function getPrizeEvent(db, id) {
  return db.prizeEvents.find(item => item.id === id) || null;
}

export function activeSettlement(db, eventId) {
  return db.settlements.find(item => item.eventId === eventId && item.status === "active") || null;
}

export function settlementsOf(db, eventId) {
  return db.settlements.filter(item => item.eventId === eventId).sort((a, b) => b.version - a.version);
}

// 写入新一版结算：旧 active 版本留档（archived），新版本成为唯一生效结算。
export function commitSettlement(db, prizeEvent, computed, recoveries) {
  const previous = activeSettlement(db, prizeEvent.id);
  if (previous) {
    previous.status = "archived";
    previous.archivedAt = new Date().toISOString();
  }
  const settlement = {
    id: newId("stl"),
    eventId: prizeEvent.id,
    event: prizeEvent.event,
    releaseDate: prizeEvent.releaseDate,
    version: previous ? previous.version + 1 : 1,
    status: "active",
    createdAt: new Date().toISOString(),
    lines: computed.lines,
    exceptions: computed.exceptions,
    recoveries: recoveries || []
  };
  db.settlements.push(settlement);
  return settlement;
}

// 更正或取消某羽鸽在某场赛事（赛事名 + 放飞日）的成绩。
export function correctRaceResult(db, ringNo, input) {
  const pigeon = db.pigeons.find(item => item.ringNo === ringNo);
  if (!pigeon) return { error: "pigeon_not_found" };
  const race = (pigeon.races || []).find(item => item.event === input.event && item.date === input.date && !item.cancelled);
  if (!race) return { error: "race_not_found" };
  if (input.rank !== undefined) {
    const rank = Number(input.rank);
    if (!Number.isInteger(rank) || rank <= 0) return { error: "invalid_rank" };
    race.rank = rank;
  }
  if (input.cancelled === true) race.cancelled = true;
  return { pigeon };
}
