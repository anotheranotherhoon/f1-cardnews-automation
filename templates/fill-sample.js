// 샘플 카드 생성: 헝가리 R11 퀄리 실데이터 → session-result 템플릿 → 완성 HTML
// (이 채움 로직은 이후 WF-2 Code 노드로 이식된다)
const fs = require('fs');

const TEAM_CLASS = {
  red_bull: 't-red_bull', ferrari: 't-ferrari', mercedes: 't-mercedes',
  mclaren: 't-mclaren', aston_martin: 't-aston_martin', alpine: 't-alpine',
  williams: 't-williams', rb: 't-rb', racing_bulls: 't-racing_bulls',
  sauber: 't-sauber', audi: 't-audi', haas: 't-haas', cadillac: 't-cadillac',
};

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function rowHtml(r) {
  const cls = TEAM_CLASS[r.teamId] || 't-default';
  return (
    '<div class="row' + (r.pos === 1 ? ' p1' : '') + ' ' + cls + '">' +
    '<div class="pos">' + r.pos + '</div>' +
    '<div class="teambar"></div>' +
    '<div class="drv"><div class="name">' + esc(r.name) + '</div><div class="team">' + esc(r.team) + '</div></div>' +
    '<div class="metric">' + esc(r.metric || '') + '</div>' +
    '</div>'
  );
}

function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : ''));
}

async function main() {
  const res = await fetch('https://api.jolpi.ca/ergast/f1/2026/11/qualifying.json?limit=40');
  const data = await res.json();
  const race = data.MRData.RaceTable.Races[0];
  const rows = race.QualifyingResults.filter((x) => x.Q3).map((x) => ({
    pos: parseInt(x.position),
    name: x.Driver.givenName + ' ' + x.Driver.familyName,
    team: x.Constructor.name,
    teamId: x.Constructor.constructorId,
    metric: x.Q3,
  }));

  const css = fs.readFileSync(__dirname + '/base.css', 'utf8');
  const tpl = fs.readFileSync(__dirname + '/session-result.html', 'utf8');
  const html = fill(tpl, {
    CSS: css,
    BG_URL: '',
    KICKER: 'Qualifying · Round ' + race.round,
    TITLE: race.raceName + ' 퀄리파잉',
    SUBTITLE: 'Q3 Top 10',
    ROWS_HTML: rows.map(rowHtml).join(''),
    NOTE: '공식 결과',
    DATE: race.date,
  });
  fs.writeFileSync(__dirname + '/sample-quali.html', html);
  console.log('OK rows:', rows.length, '| constructorIds:', [...new Set(race.QualifyingResults.map((x) => x.Constructor.constructorId))].join(','));
}
main();
