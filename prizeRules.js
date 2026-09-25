// 奖金判定：纯函数，不读写档案。
// 每场比赛按「足环 + 放飞日 + 名次」生成一笔应发奖金；
// 收款人取放飞日当天有效的鸽主，比赛之后才登记的转让不影响这笔账。

// 放飞日（含）当天生效的鸽主：按转让日期回放，最后一条不晚于 date 的转让决定归属。
export function ownerOnDate(pigeon, date) {
  const transfers = [...(pigeon.transfers || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!transfers.length) return pigeon.owner;
  let owner = transfers[0].from;
  for (const transfer of transfers) {
    if (transfer.date <= date) owner = transfer.to;
    else break;
  }
  return owner;
}

export function prizeForRank(prizes, rank) {
  const hit = (prizes || []).find(item => Number(item.rank) === Number(rank));
  return hit ? Number(hit.amount) : 0;
}

// 扫描全部鸽只档案，算出某场赛事当前榜单对应的应发明细和异常记录。
export function computeSettlement(db, prizeEvent) {
  const lines = [];
  const exceptions = [];
  for (const pigeon of db.pigeons) {
    const results = (pigeon.races || []).filter(race => race.event === prizeEvent.event && race.date === prizeEvent.releaseDate);
    const valid = results.filter(race => !race.cancelled);
    if (results.length && !valid.length) {
      exceptions.push({ type: "result_cancelled", ringNo: pigeon.ringNo, message: `${pigeon.ringNo} 本场成绩已取消，不参与结算` });
      continue;
    }
    if (valid.length > 1) {
      exceptions.push({ type: "duplicate_result", ringNo: pigeon.ringNo, message: `${pigeon.ringNo} 同场有 ${valid.length} 条成绩，只按第一条结算` });
    }
    if (!valid.length) continue;
    const race = valid[0];
    const rank = Number(race.rank);
    if (!Number.isInteger(rank) || rank <= 0) {
      exceptions.push({ type: "invalid_rank", ringNo: pigeon.ringNo, message: `${pigeon.ringNo} 名次无效（${race.rank}），未结算` });
      continue;
    }
    const amount = prizeForRank(prizeEvent.prizes, rank);
    if (amount <= 0) {
      exceptions.push({ type: "no_prize", ringNo: pigeon.ringNo, message: `${pigeon.ringNo} 第 ${rank} 名未设奖金` });
      continue;
    }
    lines.push({ ringNo: pigeon.ringNo, rank, amount, payee: ownerOnDate(pigeon, prizeEvent.releaseDate) });
  }
  lines.sort((a, b) => a.rank - b.rank || a.ringNo.localeCompare(b.ringNo));
  return { lines, exceptions };
}

// 对比上一版生效明细与本次重算结果：判断是否需要出新版本，并列出待追回款项。
export function diffSettlement(previousLines, nextLines) {
  const previous = new Map(previousLines.map(line => [line.ringNo, line]));
  const next = new Map(nextLines.map(line => [line.ringNo, line]));
  const recoveries = [];
  let changed = previous.size !== next.size;
  for (const [ringNo, prev] of previous) {
    const item = next.get(ringNo);
    if (!item) {
      changed = true;
      recoveries.push({ ringNo, payee: prev.payee, amount: prev.amount, reason: "成绩取消或移出榜单，全额追回" });
      continue;
    }
    if (item.rank !== prev.rank || item.amount !== prev.amount || item.payee !== prev.payee) changed = true;
    if (item.payee !== prev.payee) {
      recoveries.push({ ringNo, payee: prev.payee, amount: prev.amount, reason: `收款人由 ${prev.payee} 更正为 ${item.payee}，向原收款人追回` });
    } else if (item.amount < prev.amount) {
      recoveries.push({ ringNo, payee: prev.payee, amount: prev.amount - item.amount, reason: `名次由第 ${prev.rank} 名更正为第 ${item.rank} 名，追回差额` });
    }
  }
  for (const ringNo of next.keys()) {
    if (!previous.has(ringNo)) changed = true;
  }
  return { changed, recoveries };
}
