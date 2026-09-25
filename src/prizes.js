import { archiveSettlementLine, appendException, appendRecovery, nextId } from "./store.js";

// 奖金判定：按足环、放飞日和名次判定应发奖金；收款人取比赛当天有效鸽主并锁定，
// 赛后登记的转让不改已生成的收款人；重复结算幂等，榜单变更重算应收与待追回。

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

// 比赛当天有效鸽主：按转让日期回推，晚于该日的转让不影响归属
export function ownerOnDate(pigeon, date) {
  const transfers = [...(pigeon.transfers || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!transfers.length) return pigeon.owner;
  let owner = transfers[0].from || pigeon.owner;
  for (const transfer of transfers) {
    if (transfer.date <= date) owner = transfer.to;
  }
  return owner;
}

export function normalizePrizes(input) {
  const prizes = [];
  const seen = new Set();
  for (const item of Array.isArray(input) ? input : []) {
    const rank = Number(item.rank);
    const amount = Number(item.amount);
    if (!Number.isInteger(rank) || rank < 1) fail(400, "名次必须是正整数");
    if (!Number.isFinite(amount) || amount <= 0) fail(400, "奖金金额必须大于 0");
    if (seen.has(rank)) fail(400, `第 ${rank} 名奖金重复登记`);
    seen.add(rank);
    prizes.push({ rank, amount });
  }
  if (!prizes.length) fail(400, "奖金表不能为空");
  return prizes.sort((a, b) => a.rank - b.rank);
}

export function registerPrizeRace(db, input, now = new Date().toISOString()) {
  const event = String(input.event || "").trim();
  const releaseDate = String(input.releaseDate || "").trim();
  if (!event) fail(400, "赛事名称不能为空");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) fail(400, "放飞日格式应为 YYYY-MM-DD");
  if (db.prizeRaces.some(race => race.event === event && race.releaseDate === releaseDate && race.status !== "cancelled")) fail(409, "同一赛事同一放飞日已登记奖金");
  const race = { id: nextId("race"), event, releaseDate, prizes: normalizePrizes(input.prizes), status: "open", createdAt: now, settledAt: "", settleCount: 0 };
  db.prizeRaces.push(race);
  return race;
}

export function settleRace(db, raceId, now = new Date().toISOString()) {
  const race = db.prizeRaces.find(item => item.id === raceId);
  if (!race) fail(404, "赛事奖金未登记");
  if (race.status === "cancelled") fail(409, "赛事已取消，不能结算");
  const prizeMap = new Map(race.prizes.map(item => [item.rank, item.amount]));
  const summary = { raceId, event: race.event, releaseDate: race.releaseDate, created: [], unchanged: [], replaced: [], revoked: [], recoveries: [], exceptions: [] };
  const note = entry => {
    const record = appendException(db, { raceId, ...entry }, now);
    if (record) summary.exceptions.push(record);
  };

  // 1. 汇总该场有效成绩（同赛事、同放飞日、未取消）
  const results = [];
  for (const pigeon of db.pigeons) {
    (pigeon.races || []).forEach(result => {
      if (result.event === race.event && result.date === race.releaseDate && result.status !== "cancelled") {
        results.push({ pigeon, result });
      }
    });
  }

  // 2. 同一足环同一场只结算一笔，重复成绩记异常
  const seenRings = new Set();
  const valid = [];
  for (const item of results) {
    if (seenRings.has(item.pigeon.ringNo)) {
      note({ type: "duplicate_result", ringNo: item.pigeon.ringNo, message: `${item.pigeon.ringNo} 在「${race.event}」有重复成绩，仅结算首笔` });
      continue;
    }
    seenRings.add(item.pigeon.ringNo);
    valid.push(item);
  }

  const activeByRing = new Map(db.settlements.filter(line => line.raceId === raceId).map(line => [line.ringNo, line]));
  const matchedRings = new Set();

  // 3. 逐羽判定应发，已生成且未变的保持原账，不重复发钱
  for (const { pigeon, result } of valid) {
    const ringNo = pigeon.ringNo;
    matchedRings.add(ringNo);
    const rank = Number(result.rank);
    const amount = prizeMap.get(rank);
    const existing = activeByRing.get(ringNo);
    if (amount === undefined) {
      note({ type: "no_prize_for_rank", ringNo, message: `${ringNo} 第 ${rank} 名不在奖金表内，未生成应发` });
      if (existing) {
        const archived = archiveSettlementLine(db, existing, "result_corrected", now, `更正后第 ${rank} 名无奖金，原应发下架`);
        if (existing.status === "paid") summary.recoveries.push(appendRecovery(db, existing, "成绩更正后无奖金，原奖金已发放需追回", now));
        summary.revoked.push(archived);
      }
      continue;
    }
    // 收款人：历史结算（含留档）已锁定的沿用，否则取比赛当天有效鸽主
    const prior = existing || [...db.settlementArchive].reverse().find(line => line.raceId === raceId && line.ringNo === ringNo);
    const raceDayOwner = ownerOnDate(pigeon, race.releaseDate);
    const payee = prior ? prior.payee : raceDayOwner;
    if (prior && prior.payee !== raceDayOwner) {
      note({ type: "payee_locked", ringNo, message: `${ringNo} 比赛日鸽主核算为 ${raceDayOwner}，收款人仍锁定为 ${prior.payee}` });
    } else if (!prior && (pigeon.transfers || []).some(transfer => transfer.date > race.releaseDate)) {
      note({ type: "transfer_after_race", ringNo, message: `${ringNo} 在 ${race.releaseDate} 赛后登记转让，收款人按比赛日归属 ${payee} 生成` });
    }
    if (existing && existing.rank === rank && existing.amount === amount && existing.payee === payee) {
      summary.unchanged.push(existing);
      continue;
    }
    if (existing) {
      const archived = archiveSettlementLine(db, existing, "result_corrected", now, `第 ${existing.rank} 名 ${existing.amount} 元 更正为 第 ${rank} 名 ${amount} 元`);
      if (existing.status === "paid") summary.recoveries.push(appendRecovery(db, existing, `成绩更正：原第 ${existing.rank} 名奖金已发放需追回`, now));
      summary.replaced.push(archived);
    }
    const line = { id: nextId("stl"), raceId, event: race.event, releaseDate: race.releaseDate, ringNo, rank, amount, payee, status: "receivable", version: existing ? existing.version + 1 : 1, createdAt: now, paidAt: "" };
    db.settlements.push(line);
    summary.created.push(line);
  }

  // 4. 成绩被取消的应发下架留档，已发放的生成待追回
  for (const [ringNo, line] of activeByRing) {
    if (matchedRings.has(ringNo)) continue;
    const archived = archiveSettlementLine(db, line, "result_cancelled", now, "成绩被取消，应发下架");
    if (line.status === "paid") summary.recoveries.push(appendRecovery(db, line, "成绩取消：奖金已发放需追回", now));
    summary.revoked.push(archived);
  }

  race.settledAt = now;
  race.settleCount = (race.settleCount || 0) + 1;
  return summary;
}

export function cancelRace(db, raceId, now = new Date().toISOString()) {
  const race = db.prizeRaces.find(item => item.id === raceId);
  if (!race) fail(404, "赛事奖金未登记");
  if (race.status === "cancelled") fail(409, "赛事已取消");
  race.status = "cancelled";
  race.cancelledAt = now;
  const summary = { raceId, event: race.event, revoked: [], recoveries: [] };
  for (const line of [...db.settlements].filter(item => item.raceId === raceId)) {
    const archived = archiveSettlementLine(db, line, "race_cancelled", now, "赛事取消，应发下架");
    if (line.status === "paid") summary.recoveries.push(appendRecovery(db, line, "赛事取消：奖金已发放需追回", now));
    summary.revoked.push(archived);
  }
  return summary;
}

export function markLinePaid(db, lineId, now = new Date().toISOString()) {
  const line = db.settlements.find(item => item.id === lineId);
  if (!line) fail(404, "结算记录不存在或已归档");
  if (line.status === "paid") fail(409, "该笔已标记发放");
  line.status = "paid";
  line.paidAt = now;
  return line;
}

export function resolveRecovery(db, recoveryId, now = new Date().toISOString()) {
  const recovery = db.recoveries.find(item => item.id === recoveryId);
  if (!recovery) fail(404, "追回记录不存在");
  if (recovery.status === "resolved") fail(409, "该笔已追回");
  recovery.status = "resolved";
  recovery.resolvedAt = now;
  return recovery;
}
