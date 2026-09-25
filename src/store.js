import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 档案存储：鸽棚台账（含奖金结算档案）的读写、留档与追回/异常登记
const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "pigeons.json");

const seed = {
  pigeons: [
    { ringNo: "CHN-2026-001", owner: "北岸棚", fatherRing: "CHN-2022-188", motherRing: "CHN-2023-512", color: "灰", loft: "北岸A棚", vaccines: [{ date: "2026-04-01", name: "新城疫" }], transfers: [{ date: "2026-04-15", from: "育种棚", to: "北岸棚" }], races: [{ date: "2026-06-01", event: "120公里训放", distance: 120, returnTime: "10:42", rank: 18 }] },
    { ringNo: "CHN-2022-188", owner: "育种棚", fatherRing: "", motherRing: "", color: "雨点", loft: "种鸽棚", vaccines: [], transfers: [], races: [] },
    { ringNo: "CHN-2023-512", owner: "育种棚", fatherRing: "", motherRing: "", color: "红轮", loft: "种鸽棚", vaccines: [], transfers: [], races: [] }
  ],
  prizeRaces: [],
  settlements: [],
  settlementArchive: [],
  recoveries: [],
  exceptions: []
};

const collections = ["pigeons", "prizeRaces", "settlements", "settlementArchive", "recoveries", "exceptions"];

export async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  for (const key of collections) if (!Array.isArray(db[key])) db[key] = [];
  return db;
}

export async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}

let seq = 0;
export function nextId(prefix) {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

// 旧结算留档：从应收台账移入档案，永不物理删除
export function archiveSettlementLine(db, line, reason, now, note = "") {
  db.settlements = db.settlements.filter(item => item.id !== line.id);
  const archived = { ...line, archivedAt: now, archiveReason: reason, note };
  db.settlementArchive.push(archived);
  return archived;
}

// 待追回登记：已发放的奖金被更正/取消时生成
export function appendRecovery(db, line, reason, now) {
  const recovery = { id: nextId("rec"), raceId: line.raceId, event: line.event, releaseDate: line.releaseDate, ringNo: line.ringNo, payee: line.payee, amount: line.amount, reason, status: "pending", createdAt: now, resolvedAt: "" };
  db.recoveries.push(recovery);
  return recovery;
}

// 异常登记：同一场同一足环同一内容只记一次，避免重复结算刷屏
export function appendException(db, entry, now) {
  const duplicated = db.exceptions.some(item => item.type === entry.type && item.raceId === entry.raceId && item.ringNo === entry.ringNo && item.message === entry.message);
  if (duplicated) return null;
  const record = { id: nextId("exc"), createdAt: now, ...entry };
  db.exceptions.push(record);
  return record;
}
