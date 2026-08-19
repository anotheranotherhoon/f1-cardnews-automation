const { resolveDayType } = require('./day-type-logic');

async function main() {
  const res = await fetch('https://api.jolpi.ca/ergast/f1/current.json');
  const data = await res.json();
  const races = data.MRData.RaceTable.Races;

  const vegas = races.find((r) => r.raceName.includes('Las Vegas'));
  const dutch = races.find((r) => r.raceName.includes('Dutch'));
  console.log('Dutch sessions:', JSON.stringify({ FP1: dutch.FirstPractice, SQ: dutch.SprintQualifying, Sprint: dutch.Sprint, Q: dutch.Qualifying, race: dutch.date + 'T' + dutch.time }));
  console.log('Vegas race date/time:', vegas ? vegas.date + 'T' + vegas.time : 'n/a', '\n');

  const cases = [
    // [설명, KST 시각]
    ['오늘(레이스위크 아님)', '2026-08-11'],
    ['더치GP 목 프리뷰', '2026-08-20'],
    ['더치GP 금 가이드', '2026-08-21'],
    ['더치GP 토 (FP1+SQ 결과)', '2026-08-22'],
    ['더치GP 일 (스프린트+퀄리)', '2026-08-23'],
    ['더치GP 월 (레이스 총정리)', '2026-08-24'],
    ['더치GP 화 (종료)', '2026-08-25'],
    ['일본GP(비스프린트) 목', '2026-03-26'],
    ['일본GP 토 (FP1+FP2)', '2026-03-28'],
    ['일본GP 일 (FP3+퀄리)', '2026-03-29'],
    ['일본GP 월 (레이스)', '2026-03-30'],
  ];
  if (vegas) {
    const raceDate = new Date(Date.parse(vegas.date + 'T' + vegas.time) + 9 * 3600e3);
    const dayAfter = new Date(raceDate.getTime() + 24 * 3600e3).toISOString().slice(0, 10);
    cases.push([`베이거스 레이스 다음날 KST(${dayAfter})`, dayAfter]);
  }

  for (const [label, kstDate] of cases) {
    // KST 09:00 = UTC 00:00
    const nowMs = Date.parse(`${kstDate}T00:00:00Z`);
    const r = resolveDayType(races, nowMs);
    console.log(`${label.padEnd(28)} → ${r.dayType}${r.raceName ? ' | ' + r.raceName : ''}${r.reported ? ' | ended: ' + r.reported.join(',') : ''}`);
  }
}
main();
