// Varmuuskopion ja palautuksen testit eristetyssä hakemistossa.
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'elama-bktest-'));
const DATA = path.join(TMP, 'data');
const BACKUPS = path.join(TMP, 'backups');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' – ' + extra : '')); }
};
const run = (script, args = [], keep) => spawnSync(process.execPath, [script, ...args], {
  cwd: ROOT,
  env: { ...process.env, ELAMA_DATA_DIR: DATA, ELAMA_BACKUP_KEEP: keep || '30' },
  encoding: 'utf8',
});

try {
  // Luo kanta + liitetiedosto
  run('seed.js');
  fs.mkdirSync(path.join(DATA, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'uploads', 'liite.pdf'), 'testiliite');

  // 1) Varmuuskopio
  const r1 = run('backup.js', [BACKUPS]);
  ok('backup.js onnistuu', r1.status === 0, r1.stderr);
  const dirs1 = fs.readdirSync(BACKUPS);
  ok('aikaleimattu kansio syntyy', dirs1.length === 1 && /^\d{4}-\d{2}-\d{2}_\d{6}/.test(dirs1[0]));
  const bdir = path.join(BACKUPS, dirs1[0]);
  ok('kannan kopio mukana', fs.existsSync(path.join(bdir, 'elama.db')));
  ok('liitteet mukana', fs.existsSync(path.join(bdir, 'uploads', 'liite.pdf')));
  const manifest = JSON.parse(fs.readFileSync(path.join(bdir, 'manifest.json'), 'utf8'));
  ok('manifesti täsmää', manifest.upload_files === 1 && manifest.db_bytes > 0);

  // Kopio on eheä SQLite jossa seed-data tallella
  const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
  const copy = new Database(path.join(bdir, 'elama.db'), { readonly: true });
  const pages = copy.prepare('SELECT COUNT(*) n FROM pages').get().n;
  copy.close();
  const seedPages = new Database(path.join(DATA, 'elama.db'), { readonly: true })
    .prepare('SELECT COUNT(*) n FROM pages').get().n;
  ok('kopiokanta eheä (sivut tallella)', pages === seedPages, `${pages} vs ${seedPages}`);

  // 2) Säilytysraja: KEEP=2 -> kolmannen ajon jälkeen vain 2 kansiota
  run('backup.js', [BACKUPS], '2');
  run('backup.js', [BACKUPS], '2');
  const dirs2 = fs.readdirSync(BACKUPS).filter((n) => /^\d{4}/.test(n));
  ok('vanhat kopiot siivotaan (KEEP=2)', dirs2.length === 2, dirs2.length);

  // 3) Palautus: riko data, palauta, tarkista
  const db = new Database(path.join(DATA, 'elama.db'));
  db.exec('DELETE FROM pages');
  db.close();
  fs.rmSync(path.join(DATA, 'uploads', 'liite.pdf'));
  const newest = dirs2.sort().reverse()[0];
  const r2 = run('restore.js', [path.join(BACKUPS, newest)]);
  ok('restore.js onnistuu', r2.status === 0, r2.stderr);
  const restored = new Database(path.join(DATA, 'elama.db'), { readonly: true });
  ok('sivut palautuivat', restored.prepare('SELECT COUNT(*) n FROM pages').get().n === seedPages);
  restored.close();
  ok('liite palautui', fs.existsSync(path.join(DATA, 'uploads', 'liite.pdf')));
  ok('vanha data talteen ennen palautusta',
    fs.readdirSync(TMP).some((n) => n.startsWith('data_ennen_palautusta_')));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log(`\nVarmuuskopiotestit: ${pass} OK, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
