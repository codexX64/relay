// Exercice du runbook d'incident (SECURITY.md, « Incident runbook ») sur une
// instance lancée comme en production, reliée à un faux Caddy et à une fausse
// API Telegram : chaque geste de confinement et de reprise est joué par son
// vrai chemin, et son effet vérifié. Dure une vingtaine de secondes.
//   node outils/exercice-incident.mjs
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const RACINE = path.resolve(import.meta.dirname, '..');
const { Client, connexion } = await import(`${RACINE}/socle/essai/client.js`);
const { adminComplet, membreInvite, MDP_ESSAI } = await import(`${RACINE}/socle/essai/inscription.js`);

const D = fs.mkdtempSync(path.join(os.tmpdir(), 'exercice-incident-')), DONNEES = path.join(D, 'data');
const SOCKET = path.join(D, 'caddy.sock');
const PORT = 19000 + crypto.randomInt(1000), JETON = crypto.randomBytes(24).toString('base64url');
const CLE1 = crypto.randomBytes(32).toString('base64'), CLE2 = crypto.randomBytes(32).toString('base64');
const JETON_TG = '123456:jeton-telegram-de-l-exercice-abcdef';

// Un faux Caddy (il garde la configuration reçue) et une fausse API Telegram.
const caddy = { conf: null };
const fauxCaddy = http.createServer((req, res) => {
  let corps = '';
  req.on('data', d => { corps += d; });
  req.on('end', () => {
    if (req.method === 'POST' && req.url === '/load') { caddy.conf = JSON.parse(corps); res.writeHead(200); return res.end('{}'); }
    if (req.method === 'GET' && req.url === '/config/apps/http/servers' && caddy.conf) { res.writeHead(200); return res.end(JSON.stringify(caddy.conf.apps.http.servers)); }
    res.writeHead(400); res.end('{}');
  });
});
const messages = [];
const fauxTg = http.createServer((req, res) => {
  let corps = '';
  req.on('data', d => { corps += d; });
  req.on('end', () => {
    const ok = r => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, result: r })); };
    if (!req.url.startsWith(`/bot${JETON_TG}/`)) { res.writeHead(401); return res.end('{"ok":false,"description":"Unauthorized"}'); }
    if (req.url.endsWith('/getMe')) return ok({ username: 'relay_exercice_bot' });
    if (req.url.endsWith('/sendMessage')) { messages.push(JSON.parse(corps)); return ok({}); }
    if (req.url.endsWith('/getUpdates')) return setTimeout(() => ok([]), 200);
    ok({});
  });
});
await new Promise(r => fauxCaddy.listen(SOCKET, r));
await new Promise(r => fauxTg.listen(0, '127.0.0.1', r));
const TG = `http://127.0.0.1:${fauxTg.address().port}`;

const rapport = [];
let proc, sortie = '';
const fin = async code => {
  try { proc?.kill('SIGKILL'); } catch { /* déjà arrêté */ }
  fauxCaddy.close(); fauxTg.close(); fs.rmSync(D, { recursive: true, force: true }); process.exit(code);
};
const note = async (ok, quoi) => { rapport.push(`${ok ? 'OK ' : 'ÉCHEC'} ${quoi}`); if (!ok) { console.log(rapport.join('\n')); console.log(sortie.slice(-2000)); await fin(1); } };
const ENV = { PATH: process.env.PATH, DATA_DIR: DONNEES, RELAY_CADDY_SOCKET: SOCKET, RELAY_TG_API: TG };
// Asynchrone : le faux Caddy vit dans ce processus et doit pouvoir répondre à la ligne de commande.
const cli = (args, entree = '', env = {}) => new Promise(ok => {
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/cli.js', ...args], { cwd: RACINE, env: { ...ENV, ...env } });
  const out = [], err = [];
  p.stdout.on('data', d => out.push(d)); p.stderr.on('data', d => err.push(d));
  p.on('close', status => ok({ status, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString() }));
  p.stdin.end(entree);
});

async function demarrer(env) {
  sortie = '';
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/main.js'], { cwd: RACINE, env: {
    ...ENV, PORT: String(PORT), HOTE: '127.0.0.1', SOCLE_JETON_INSTALLATION: JETON, ...env,
  } });
  proc.stdout.on('data', d => { sortie += d; }); proc.stderr.on('data', d => { sortie += d; });
  for (let i = 0; i < 100; i++) {
    if ((await fetch(`http://127.0.0.1:${PORT}/api/health`).then(x => x.status, () => 0)) === 200) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}
const arreter = () => new Promise(r => { proc.on('exit', r); proc.kill('SIGTERM'); });
const jeton = j => ({ entetes: { authorization: `Bearer ${j}` }, origine: null });
const parCle = async (auth) => {
  const c = new Client(PORT);
  const o = await c.post('/api/compte/connexion/cle/options');
  return (await c.post('/api/compte/connexion/cle', { reponse: auth.signer(o.json, c.origine) })).json?.niveau === 'complet' ? c : null;
};

const HUB1 = crypto.randomBytes(24).toString('base64url'), HUB2 = crypto.randomBytes(24).toString('base64url');
await note(await demarrer({ RELAY_HUB_TOKEN: HUB1, SOCLE_CLE: CLE1 }), 'démarrage : jeton du Hub n° 1, clé maîtresse n° 1');
const admin = new Client(PORT);
const { auth } = await adminComplet(admin, { jeton: JETON });
const { client: membre, compteId } = await membreInvite(admin, () => new Client(PORT), { identifiant: 'bruno' });
await note((await admin.put('/api/reglages/telegram', { jeton: JETON_TG, alertes: true })).status === 200, 'bot Telegram enregistré (renfort de la clé d’accès)');
await new Promise(r => setTimeout(r, 150));
const route = await admin.post('/api/routes', { hote: 'carte.exemple.fr', cible: 'hub-carte:8090', mode: 'local' });
await note(route.status === 200 && JSON.stringify(caddy.conf).includes('carte.exemple.fr'), 'une route servie par Caddy');
const svc = await admin.post('/api/clients', { nom: 'carte' });
await note(svc.status === 200 && (await new Client(PORT).req('GET', '/api/whoami', undefined, jeton(svc.json.jeton))).status === 200, 'un service raccordé, son jeton ouvre');

// 1. Détecter
await note((await membre.post('/api/routes', { hote: 'intrus.exemple.fr', cible: 'ailleurs:80' })).status === 403, 'un geste interdit (une route posée par un membre) est refusé');
const journal = (await admin.get('/api/compte/admin/journal')).json;
await note(journal.lignes.some(l => l.action === 'acces.refuse') && journal.integrite.ok, 'détecter : le refus est au journal, chaîne intacte');
// 2. Fermer toutes les sessions sauf la sienne
await note((await admin.post('/api/compte/admin/sessions/fermer-tout')).status === 200, 'toutes les sessions fermées');
await note((await membre.get('/api/etat')).status === 401 && (await admin.get('/api/etat')).status === 200, 'la session du membre est morte, pas celle de l’administrateur');
// 3. Tourner le jeton du Hub et la clé maîtresse
await arreter();
await note(await demarrer({ RELAY_HUB_TOKEN: HUB2, SOCLE_CLE: CLE2, SOCLE_CLE_ANCIENNE: CLE1 }), 'redéploiement : jeton du Hub n° 2, clé n° 2 (n° 1 en ancienne)');
await note((await new Client(PORT).req('GET', '/api/etat', undefined, jeton(HUB1))).status === 401 && (await new Client(PORT).req('GET', '/api/etat', undefined, jeton(HUB2))).status === 200, 'l’ancien jeton du Hub ne vaut plus rien, le nouveau ouvre');
await arreter();
await note(await demarrer({ RELAY_HUB_TOKEN: HUB2, SOCLE_CLE: CLE2 }), 'redémarrage sous la seule clé n° 2');
const a2 = await parCle(auth);
await note(!!a2, 'l’administrateur se reconnecte avec sa clé d’accès');
// 4. Tourner le jeton d'un service raccordé
const rot = await a2.post(`/api/clients/${svc.json.client.id}/tourner`);
await note(rot.status === 200 && (await new Client(PORT).req('GET', '/api/whoami', undefined, jeton(svc.json.jeton))).status === 401
  && (await new Client(PORT).req('GET', '/api/whoami', undefined, jeton(rot.json.jeton))).json?.service === 'carte', 'l’ancien jeton du service ne vaut plus rien, le nouveau ouvre, ses routes restent');
// 5. Retirer les secrets des réglages (ils se révoquent aussi chez leurs fournisseurs)
// Un chat lié (comme par /lier depuis Telegram), pour que l'essai d'alerte parte vraiment.
const { DatabaseSync } = await import('node:sqlite');
const base = new DatabaseSync(path.join(DONNEES, 'relay.db'));
const tg = JSON.parse(base.prepare("SELECT valeur FROM reglages WHERE cle = 'telegram'").get().valeur);
base.prepare("UPDATE reglages SET valeur = ? WHERE cle = 'telegram'").run(JSON.stringify({ ...tg, chat: '-100123' }));
base.close();
const avant = await a2.post('/api/telegram/essai');
await note(avant.status === 200 && messages.length > 0, 'le jeton Telegram, rescellé sous la clé n° 2, sert encore');
const retrait = await cli(['secrets', 'retirer'], '', { RELAY_HUB_TOKEN: HUB2, SOCLE_CLE: CLE2 });
await note(retrait.status === 0 && /telegram\.jeton/.test(String(retrait.stdout)), 'secrets retirés en ligne de commande, service en marche');
const essai = await a2.post('/api/telegram/essai');
await note(essai.status === 502 && /jeton du bot/.test(essai.json?.error || ''), 'plus aucune alerte ne part avec l’ancien jeton Telegram');
// 6. Forcer un nouveau mot de passe
const reinit = await a2.post(`/api/compte/admin/comptes/${compteId}/reinit`);
await note(reinit.status === 200, 'lien de réinitialisation émis pour le membre');
const nouveau = MDP_ESSAI + ' après incident';
await note((await new Client(PORT).post('/api/compte/jeton', { usage: 'reinit', jeton: reinit.json.lien.split('#reinit=')[1], motDePasse: nouveau })).status === 200, 'le membre pose un nouveau mot de passe');
await note((await connexion(new Client(PORT), 'bruno', MDP_ESSAI + ' bruno')).status === 401, 'l’ancien mot de passe ne vaut plus rien');
await note((await connexion(new Client(PORT), 'bruno', nouveau)).json?.etape === 'second', 'le nouveau ouvre, et le second facteur reste exigé');
// 7. Restaurer depuis une sauvegarde
const paire = crypto.generateKeyPairSync('rsa', { modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const sauv = await cli(['sauvegarde'], paire.publicKey, { RELAY_HUB_TOKEN: HUB2 });
await note(sauv.status === 0 && sauv.stdout.length > 0, 'sauvegarde chiffrée tirée pendant que le service tourne');
await note((await a2.get('/api/compte/admin/journal')).json.lignes.some(l => l.action === 'sauvegarde.faite'), 'la sauvegarde est inscrite au journal');
await arreter();
const prive = path.join(D, 'prive.pem'), restauree = path.join(D, 'restauree.db');
fs.writeFileSync(prive, paire.privateKey);
await note((await cli(['restaurer', prive, restauree], sauv.stdout)).status === 0, 'restaurée ailleurs avec la clé privée seule');
for (const f of ['relay.db', 'relay.db-wal', 'relay.db-shm']) fs.rmSync(path.join(DONNEES, f), { force: true });
fs.copyFileSync(restauree, path.join(DONNEES, 'relay.db'));
fs.chmodSync(path.join(DONNEES, 'relay.db'), 0o600);
caddy.conf = null;
await note(await demarrer({ RELAY_HUB_TOKEN: HUB2, SOCLE_CLE: CLE2 }), 'redémarrage sur la base restaurée');
const c = await parCle(auth);
await note(!!c, 'l’administrateur se reconnecte avec sa clé d’accès');
await note((await c.get('/api/etat')).json.routes.some(r => r.hote === 'carte.exemple.fr'), 'les routes sont revenues');
for (let i = 0; i < 50 && !JSON.stringify(caddy.conf || {}).includes('carte.exemple.fr'); i++) await new Promise(r => setTimeout(r, 100));
await note(JSON.stringify(caddy.conf || {}).includes('carte.exemple.fr'), 'Caddy les sert de nouveau sans geste');
// 8. Vérifier la chaîne du journal
const apres = (await c.get('/api/compte/admin/journal')).json;
await note(apres.integrite.ok && ['sessions.toutes_fermees', 'client.tourne', 'secrets.retires', 'compte.reinit_emis'].every(a => apres.lignes.some(l => l.action === a)), 'base restaurée : chaîne du journal intacte, chaque geste d’avant la sauvegarde inscrit');
await arreter();
console.log(`Exercice du runbook d'incident, ${new Date().toISOString()}\n${rapport.join('\n')}\n${rapport.length} vérifications réussies.`);
await fin(0);
