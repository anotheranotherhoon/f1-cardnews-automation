// OpenF1 브랜치 로컬 검증: wf1 JSON의 실제 jsCode를 추출해 $/$input 심으로 실행
const fs = require('fs');
const wf = JSON.parse(fs.readFileSync(__dirname + '/wf1-main-scheduler.json', 'utf8'));
const codeOf = (name) => wf.nodes.find((n) => n.name === name).parameters.jsCode;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  await sleep(4000); // OpenF1 레이트리밋 배려
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ' → HTTP ' + res.status + ' ' + (await res.text()).slice(0, 100));
  return res.json();
}

function runCode(name, outputs, inputName) {
  const $ = (n) => {
    if (!outputs[n]) throw new Error('no output recorded for ' + n);
    return { first: () => ({ json: outputs[n][0] }), all: () => outputs[n].map((j) => ({ json: j })) };
  };
  const $input = $(inputName);
  const fn = new Function('$', '$input', 'Date', codeOf(name));
  const items = fn($, $input, Date);
  return items.map((i) => i.json);
}

async function jolpica(path) {
  return [await get('https://api.jolpi.ca/ergast/f1/' + path)];
}
async function openf1(path) {
  const arr = await get('https://api.openf1.org/v1/' + path);
  return arr; // 배열 그대로 아이템화
}

async function resolveMeta(dayType, round) {
  const cal = await jolpica('current.json');
  const outputs = { 'Jolpica Calendar': cal };
  const code = codeOf('Resolve Day Type').replace('const OVERRIDE = null;', `const OVERRIDE = {dayType:'${dayType}', round:'${round}'};`);
  const fn = new Function('$', '$input', 'Date', code);
  const $ = (n) => ({ first: () => ({ json: outputs[n][0] }), all: () => outputs[n].map((j) => ({ json: j })) });
  return fn($, $('Jolpica Calendar'), Date)[0].json;
}

async function testSaturday(dayType, round, label) {
  const meta = await resolveMeta(dayType, round);
  const outputs = { 'Resolve Day Type': [meta] };
  outputs['OF Meetings'] = await openf1('meetings?year=' + meta.season);
  outputs['OF Pick Meeting'] = runCode('OF Pick Meeting', outputs, 'OF Meetings');
  const mk = outputs['OF Pick Meeting'][0].meeting_key;
  outputs['OF Sessions'] = await openf1('sessions?meeting_key=' + mk);
  outputs['OF Pick Sessions'] = runCode('OF Pick Sessions', outputs, 'OF Sessions');
  const s = outputs['OF Pick Sessions'][0];
  outputs['OF Result1'] = await openf1('session_result?session_key=' + s.s1.key);
  outputs['OF Result2'] = await openf1('session_result?session_key=' + s.s2.key);
  outputs['OF Drivers1'] = await openf1('drivers?session_key=' + s.s1.key);
  outputs['OF Drivers2'] = await openf1('drivers?session_key=' + s.s2.key);
  const cards = runCode('OF Cards', outputs, 'OF Drivers2')[0];
  console.log(`✓ ${label}: ${cards.cards.length}장 [${cards.cards.map((c) => c.type).join(', ')}]`);
  const sr = cards.cards.find((c) => c.type === 'session-result');
  console.log('  샘플 행:', JSON.stringify(sr.data.rows[0]));
  return cards;
}

async function testRecap(round) {
  const meta = await resolveMeta('race-recap', round);
  const outputs = { 'Resolve Day Type': [meta] };
  outputs['RC Results'] = await jolpica(`${meta.season}/${meta.round}/results.json?limit=40`);
  outputs['RC DrvNow'] = await jolpica(`${meta.season}/${meta.round}/driverstandings.json?limit=40`);
  outputs['RC DrvPrev'] = await jolpica(`${meta.season}/${Math.max(1, meta.prevRound)}/driverstandings.json?limit=40`);
  outputs['RC ConNow'] = await jolpica(`${meta.season}/${meta.round}/constructorstandings.json?limit=20`);
  outputs['RC ConPrev'] = await jolpica(`${meta.season}/${Math.max(1, meta.prevRound)}/constructorstandings.json?limit=20`);
  outputs['RC OFMeet'] = await openf1('meetings?year=' + meta.season);
  outputs['RC OFPick'] = runCode('RC OFPick', outputs, 'RC OFMeet');
  outputs['RC OFSess'] = await openf1('sessions?meeting_key=' + outputs['RC OFPick'][0].meeting_key);
  outputs['RC OFRace'] = runCode('RC OFRace', outputs, 'RC OFSess');
  outputs['RC Stints'] = await openf1('stints?session_key=' + outputs['RC OFRace'][0].race_session_key);
  outputs['RC OFDrv'] = await openf1('drivers?session_key=' + outputs['RC OFRace'][0].race_session_key);
  const cards = runCode('RC Cards', outputs, 'RC OFDrv')[0];
  console.log(`✓ 월 총정리 (R${round}): ${cards.cards.length}장 [${cards.cards.map((c) => c.type).join(', ')}]`);
  const st = cards.cards.find((c) => c.type === 'stints');
  console.log('  스틴트 샘플:', JSON.stringify(st.data.rows[0]));
  const sd = cards.cards.find((c) => c.type === 'standings-drivers');
  console.log('  등락 샘플:', JSON.stringify(sd.data.rows.slice(0, 3)));
  return cards;
}

(async () => {
  try {
    await testSaturday('practice-results', 11, '토 FP1·FP2 (헝가리 R11)');
    await testSaturday('sprint-fri-results', 2, '토S FP1·SQ (중국 R2)');
    await testRecap(11);
    console.log('\n3/3 브랜치 로직 검증 통과');
  } catch (e) {
    console.error('✗ 실패:', e.message);
    process.exit(1);
  }
})();
