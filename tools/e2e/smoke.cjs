// Smoke test: the lobby loads for dad on a phone-sized screen, a duel starts from Quick play,
// and a Gauntlet starts from the rival panel. Run tools/e2e/setup.sh first.
//   node tools/e2e/smoke.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const open = require('./harness.cjs'), { execSync } = require('child_process');
const DIR = process.env.E2E_DIR || '/var/tmp/gr-e2e', PORT = process.env.E2E_PG_PORT || 5499;
const q = (s) => execSync(`psql -h ${DIR} -p ${PORT} -U postgres -d game -At -c "${s}"`).toString().trim();
(async () => {
  const b = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  const dad = q("select id from profiles where username='dad_commander'"), out = {};
  const p = await open(b, dad, 'dad_commander', '', { mobile: true });
  await p.waitForSelector('#gtStart', { timeout: 30000 });
  await p.tap('.ncard[data-kind=duel]'); await p.tap('#newgame [data-opp="phoenix_lord"]'); await p.tap('#start');
  await p.waitForTimeout(2500); out.duel = p.url();
  await p.goto('http://app.test/'); await p.waitForSelector('#gtStart');
  await p.tap('[data-gopp="obanai_rocks"]'); await p.tap('#gtGo'); await p.waitForTimeout(3000); out.gauntlet = p.url();
  out.ok = /duel\.html#game=/.test(out.duel) && /game=/.test(out.gauntlet) && !p.errs.length;
  console.log(JSON.stringify(out, null, 1), 'errors', p.errs);
  await b.close(); process.exit(out.ok ? 0 : 1);
})();
