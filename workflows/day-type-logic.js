// WF-1 Code 노드 로직: 오늘(KST)의 콘텐츠 타입 판별
// n8n Code 노드에 그대로 들어가는 함수. 테스트를 위해 분리.
//
// 규칙 (design.md D2):
// - preview: 다음 레이스 FP1의 KST 날짜 - 1일
// - guide: FP1의 KST 날짜 당일
// - 결과 카드: "지난 24시간 안에 종료된 세션" 집합으로 판별
//   비스프린트  토={FP1,FP2} → practice-results / 일={FP3,Quali} → quali-results / 월={Race} → race-recap
//   스프린트    토={FP1,SQ} → sprint-fri-results / 일={Sprint,Quali} → sprint-sat-results / 월={Race} → race-recap

const SESSION_KEYS = {
  FirstPractice: 'FP1',
  SecondPractice: 'FP2',
  ThirdPractice: 'FP3',
  SprintQualifying: 'SQ',
  Sprint: 'SPRINT',
  Qualifying: 'QUALI',
};
// 세션 종료 추정: 시작 + 소요시간(분)
const SESSION_DURATION_MIN = { FP1: 90, FP2: 90, FP3: 90, SQ: 60, SPRINT: 60, QUALI: 90, RACE: 165 };
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstDateStr(utcMs) {
  return new Date(utcMs + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function collectSessions(race) {
  const out = [];
  for (const [key, code] of Object.entries(SESSION_KEYS)) {
    if (race[key] && race[key].date && race[key].time) {
      out.push({ code, startMs: Date.parse(`${race[key].date}T${race[key].time}`) });
    }
  }
  if (race.date && race.time) {
    out.push({ code: 'RACE', startMs: Date.parse(`${race.date}T${race.time}`) });
  }
  for (const s of out) s.endMs = s.startMs + SESSION_DURATION_MIN[s.code] * 60 * 1000;
  return out.sort((a, b) => a.startMs - b.startMs);
}

function resolveDayType(races, nowMs) {
  const todayKst = kstDateStr(nowMs);

  for (const race of races) {
    const sessions = collectSessions(race);
    if (!sessions.length) continue;
    const isSprint = !!race.Sprint;
    const fp1 = sessions.find((s) => s.code === 'FP1');
    const base = {
      round: race.round,
      raceName: race.raceName,
      circuitName: race.Circuit ? race.Circuit.circuitName : null,
      season: race.season,
      isSprint,
      sessions: sessions.map((s) => ({
        code: s.code,
        startKst: new Date(s.startMs + KST_OFFSET_MS).toISOString().replace('T', ' ').slice(0, 16) + ' KST',
      })),
    };

    // 프리뷰: FP1 KST 날짜의 전날
    if (fp1) {
      const fp1Kst = kstDateStr(fp1.startMs);
      const prevDay = kstDateStr(fp1.startMs - 24 * 60 * 60 * 1000);
      if (todayKst === prevDay) return { dayType: 'preview', ...base };
      if (todayKst === fp1Kst) return { dayType: 'guide', ...base };
    }

    // 결과: 지난 24시간 내 종료된 세션 집합
    const ended = sessions.filter((s) => s.endMs <= nowMs && s.endMs > nowMs - 24 * 60 * 60 * 1000);
    if (!ended.length) continue;
    const codes = new Set(ended.map((s) => s.code));
    const reported = [...codes];

    if (codes.has('RACE')) return { dayType: 'race-recap', reported, ...base };
    if (isSprint) {
      if (codes.has('SPRINT') || (codes.has('QUALI') && !codes.has('FP1')))
        return { dayType: 'sprint-sat-results', reported, ...base };
      if (codes.has('SQ') || codes.has('FP1')) return { dayType: 'sprint-fri-results', reported, ...base };
    } else {
      if (codes.has('QUALI') || codes.has('FP3')) return { dayType: 'quali-results', reported, ...base };
      if (codes.has('FP1') || codes.has('FP2')) return { dayType: 'practice-results', reported, ...base };
    }
  }
  return { dayType: 'none' };
}

module.exports = { resolveDayType };
