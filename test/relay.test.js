// Relay de bout en bout, par HTTP : un faux Caddy sur un socket Unix (il
// garde la configuration reçue, refuse celle qu'on lui dit de refuser), de
// fausses API Cloudflare et Telegram, et le vrai serveur de Relay.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Client } from '../socle/essai/client.js';
import { adminComplet, membreInvite } from '../socle/essai/inscription.js';
import { demarrer } from '../src/main.js';
import { construire, lireCible, Caddy } from '../src/caddy.js';
import { normaliser } from '../src/relais.js';
import { Cloudflare } from '../src/cloudflare.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-'));
const SOCKET = path.join(tmp, 'admin.sock');
const DNS = path.join(tmp, 'dns'); fs.mkdirSync(DNS);
const JETON_HUB = 'jeton-du-hub-pour-les-essais-0123456789';
const silence = { info() {}, warn() {}, error() {} };

// ---- faux Caddy ----
const caddy = { conf: null, refuser: null, appels: 0 };
const faux = http.createServer((req, res) => {
  let corps = '';
  req.on('data', d => { corps += d; });
  req.on('end', () => {
    const json = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'POST' && req.url === '/load') {
      caddy.appels++;
      const c = JSON.parse(corps);
      if (caddy.refuser && corps.includes(caddy.refuser)) { res.writeHead(400); return res.end(`{"error":"loading config: ${caddy.refuser} refusé"}`); }
      caddy.conf = c;
      return json(200, {});
    }
    if (req.method === 'GET' && req.url === '/config/apps/http/servers') {
      if (!caddy.conf) { res.writeHead(400); return res.end('{"error":"invalid traversal path at: config/apps"}'); }
      return json(200, caddy.conf.apps.http.servers);
    }
    if (req.method === 'GET' && req.url === '/pki/ca/local') return json(200, { root_certificate: '-----BEGIN CERTIFICATE-----\nESSAI\n-----END CERTIFICATE-----\n' });
    res.writeHead(404); res.end();
  });
});

// ---- fausses API Cloudflare et Telegram ----
const cf = { ingress: [{ hostname: 'autre.exemple.fr', service: 'http://ailleurs:80' }, { service: 'http_status:404' }], dns: [], ecritures: 0, n: 0 };
const tg = { messages: [], maj: [] };
const externe = http.createServer((req, res) => {
  let corps = '';
  req.on('data', d => { corps += d; });
  req.on('end', () => {
    const ok = result => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, ok: true, result })); };
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/tg/')) {
      if (!u.pathname.includes('/bot123456:jeton-telegram-de-test-abcdefgh/')) { res.writeHead(401); return res.end('{"ok":false,"description":"Unauthorized"}'); }
      if (u.pathname.endsWith('/getMe')) return ok({ username: 'relay_essai_bot' });
      if (u.pathname.endsWith('/sendMessage')) { tg.messages.push(JSON.parse(corps)); return ok({}); }
      if (u.pathname.endsWith('/getUpdates')) { const m = tg.maj.splice(0); return setTimeout(() => ok(m), m.length ? 0 : 200); }
    }
    if (req.headers.authorization !== 'Bearer cf-jeton-de-test-0123456789abcdef') { res.writeHead(403); return res.end('{"success":false,"errors":[{"code":9109,"message":"Invalid access token"}]}'); }
    if (u.pathname === '/cf/user/tokens/verify') return ok({ status: 'active' });
    if (u.pathname === '/cf/accounts') return ok([{ id: 'a1b2c3', name: 'Labo' }]);
    if (u.pathname === '/cf/accounts/a1b2c3/cfd_tunnel') return ok([{ id: '11111111-2222-3333-4444-555555555555', name: 'maison' }]);
    if (u.pathname.endsWith('/configurations')) {
      if (req.method === 'PUT') { cf.ecritures++; cf.ingress = JSON.parse(corps).config.ingress; return ok({}); }
      return ok({ config: { ingress: cf.ingress } });
    }
    if (u.pathname === '/cf/zones') return ok([{ id: 'z1', name: 'exemple.fr' }]);
    if (u.pathname === '/cf/zones/z1/dns_records') {
      if (req.method === 'POST') { cf.dns.push({ id: `d${++cf.n}`, ...JSON.parse(corps) }); return ok({}); }
      return ok(cf.dns.filter(d => d.name === u.searchParams.get('name')));
    }
    const enr = /^\/cf\/zones\/z1\/dns_records\/(\w+)$/.exec(u.pathname);
    if (enr) {
      const i = cf.dns.findIndex(d => d.id === enr[1]);
      if (i < 0) { res.writeHead(404); return res.end('{"success":false}'); }
      if (req.method === 'DELETE') { cf.dns.splice(i, 1); return ok({}); }
      if (req.method === 'PUT') { cf.dns[i] = { id: enr[1], ...JSON.parse(corps) }; return ok({}); }
    }
    res.writeHead(404); res.end('{}');
  });
});

let relay, port, admin, membre, cible, cibleMorte, ext;
const hubReq = (methode, chemin, corps, jeton = JETON_HUB) => new Client(port).req(methode, chemin, corps, { entetes: { authorization: `Bearer ${jeton}` }, origine: null });

before(async () => {
  process.umask(0o077);   // comme en production (src/main.js)
  await new Promise(r => faux.listen(SOCKET, r));
  await new Promise(r => externe.listen(0, '127.0.0.1', r));
  ext = `http://127.0.0.1:${externe.address().port}`;
  // Une cible qui répond, une qui ne répond pas.
  cible = http.createServer((req, res) => { res.writeHead(req.headers.host === 'panne.exemple.fr' ? 502 : 200); res.end('ok'); }); await new Promise(r => cible.listen(0, '127.0.0.1', r));
  const t = net.createServer(); await new Promise(r => t.listen(0, '127.0.0.1', r)); cibleMorte = t.address().port; await new Promise(r => t.close(r));
  relay = await demarrer({
    DATA_DIR: path.join(tmp, 'data'), PORT: '0', HOTE: '127.0.0.1', RELAY_CADDY_SOCKET: SOCKET, RELAY_HUB_TOKEN: JETON_HUB,
    RELAY_CF_API: ext + '/cf', RELAY_TG_API: ext + '/tg', RELAY_IP: '192.0.2.10', RELAY_DNS_DIR: DNS, SOCLE_JETON_INSTALLATION: 'jeton-d-installation-pour-les-essais',
  }, { log: silence });
  port = relay.port;
  admin = new Client(port);
  await adminComplet(admin, { jeton: 'jeton-d-installation-pour-les-essais' });
  membre = (await membreInvite(admin, () => new Client(port), { identifiant: 'lea', role: 'lecture' })).client;
});
after(async () => { await relay?.arreter(); faux.close(); externe.close(); cible.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('configuration de Caddy : 80 redirige, 443 sert, un certificat par mode, l’API sur le socket', () => {
  const conf = construire([
    { hote: 'a.exemple.fr', cible: 'hub-a:8090', mode: 'local', actif: true },
    { hote: 'b.exemple.fr', cible: 'https://192.0.2.20:8006', mode: 'public', actif: true, verifier: false },
    { hote: 'c.exemple.fr', cible: 'hub-c:80', mode: 'clair', cf: true, actif: true },
    { hote: 'd.exemple.fr', cible: 'hub-d:80', mode: 'local', actif: false },
  ], { socket: '/run/caddy/admin.sock', acme: 'ops@exemple.fr' });
  assert.equal(conf.admin.listen, 'unix//run/caddy/admin.sock|0666');
  const s = conf.apps.http.servers;
  assert.deepEqual(s.web.routes.map(r => r.match[0].host[0]), ['c.exemple.fr', 'a.exemple.fr', 'b.exemple.fr']);
  assert.equal(s.web.routes[1].handle[0].status_code, 308);
  assert.deepEqual(s.websecure.routes.map(r => r.match[0].host[0]), ['a.exemple.fr', 'b.exemple.fr'], 'une route en pause n’est pas servie');
  assert.deepEqual(s.websecure.routes[1].handle[0].transport, { protocol: 'http', tls: { insecure_skip_verify: true } });
  assert.deepEqual(s.web.routes[0].handle[0].headers.request.set['X-Forwarded-Proto'], ['https'], 'derrière le tunnel, le service sait qu’il est en HTTPS');
  assert.deepEqual(conf.apps.tls.automation.policies, [{ subjects: ['a.exemple.fr'], issuers: [{ module: 'internal' }] }, { subjects: ['b.exemple.fr'], issuers: [{ module: 'acme', email: 'ops@exemple.fr' }] }]);
  assert.deepEqual(conf.admin.config, { persist: false }, 'la configuration n’est jamais écrite sur le disque de Caddy');
  // Une zone Cloudflare connectée : ses noms locaux ont un certificat Let's Encrypt par le défi DNS.
  const avecCf = construire([
    { hote: 'a.exemple.fr', cible: 'hub-a:8090', mode: 'local', actif: true },
    { hote: 'nas.home.arpa', cible: 'hub-n:80', mode: 'local', actif: true },
  ], { socket: '/s', cloudflare: { zones: ['exemple.fr'], jeton: 'jeton-cf' } });
  assert.deepEqual(avecCf.apps.tls.automation.policies, [
    { subjects: ['a.exemple.fr'], issuers: [{ module: 'acme', challenges: { dns: { provider: { name: 'cloudflare', api_token: 'jeton-cf' }, resolvers: ['1.1.1.1:53', '1.0.0.1:53'] } } }] },
    { subjects: ['nas.home.arpa'], issuers: [{ module: 'internal' }] },
  ]);
  assert.deepEqual(lireCible('https://192.0.2.20'), { schema: 'https', hote: '192.0.2.20', port: 443, dial: '192.0.2.20:443' });
});

test('saisie : nom, cible et mode contrôlés ; le tunnel force le mode sans TLS', () => {
  assert.throws(() => normaliser({ hote: 'pas un nom', cible: 'a:80', mode: 'local' }), /Nom invalide/);
  assert.throws(() => normaliser({ hote: 'a.exemple.fr', cible: 'http://user:mdp@a:80', mode: 'local' }), /Cible invalide/);
  assert.throws(() => normaliser({ hote: 'a.exemple.fr', cible: 'a:80/chemin', mode: 'local' }), /Cible invalide/);
  assert.throws(() => normaliser({ hote: 'a.exemple.fr', cible: 'a:99999', mode: 'local' }), /port/);
  assert.throws(() => normaliser({ hote: 'a.exemple.fr', cible: 'a:80', mode: 'magique' }), /Mode inconnu/);
  assert.equal(normaliser({ hote: 'HTTPS://A.Exemple.fr/x', cible: 'a:80', mode: 'public', cf: true }).mode, 'clair');
  assert.equal(normaliser({ hote: 'https://A.Exemple.fr/x', cible: 'a:80', mode: 'local' }).hote, 'a.exemple.fr');
});

test('autorisation : sans session ni jeton, rien ; la lecture voit, n’écrit pas ; un faux jeton est compté', async () => {
  const anonyme = new Client(port);
  assert.equal((await anonyme.get('/api/health')).status, 200);
  for (const [m, c] of [['GET', '/api/etat'], ['POST', '/api/routes'], ['GET', '/api/clients'], ['GET', '/api/reglages'], ['PUT', '/api/hub/publication'], ['GET', '/api/whoami']]) {
    const r = await anonyme.req(m, c, m === 'GET' ? undefined : {});
    assert.ok([401, 403].includes(r.status), `${m} ${c} → ${r.status}`);
  }
  assert.equal((await membre.get('/api/etat')).status, 200);
  assert.equal((await membre.post('/api/routes', { hote: 'x.exemple.fr', cible: 'a:80' })).status, 403);
  assert.equal((await membre.get('/api/reglages')).status, 403);
  assert.equal((await hubReq('GET', '/api/etat', undefined, 'faux-jeton-faux-jeton-faux-jeton')).status, 401);
  assert.equal((await hubReq('GET', '/api/reglages')).status, 401, 'le jeton du Hub n’ouvre pas les réglages (session exigée)');
  assert.equal((await hubReq('GET', '/api/clients')).status, 401);
  assert.equal((await anonyme.get('/api/etat?x=1')).status, 400, 'un paramètre non déclaré est refusé');
});

test('publication par le Hub : idempotente, au domaine de base, jamais sur le nom d’un autre', async () => {
  let r = await hubReq('PUT', '/api/hub/publication', { service: 'mapmylan', sousDomaine: 'carte', cible: `127.0.0.1:${cible.address().port}` });
  assert.equal(r.status, 400, 'sans domaine de base, un sous-domaine ne suffit pas');
  assert.equal((await hubReq('PUT', '/api/reglages/general', { domaines: ['exemple.fr'] })).status, 200, 'le Hub règle les domaines');
  r = await hubReq('PUT', '/api/hub/publication', { service: 'mapmylan', sousDomaine: 'carte', cible: `127.0.0.1:${cible.address().port}`, mode: 'local' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.url, 'https://carte.exemple.fr');
  assert.equal(r.json.route.proprietaire, 'hub:mapmylan');
  const id = r.json.route.id;
  r = await hubReq('PUT', '/api/hub/publication', { service: 'mapmylan', sousDomaine: 'carte', cible: `127.0.0.1:${cible.address().port}`, mode: 'public' });
  assert.equal(r.json.route.id, id, 'mise à jour, pas de doublon');
  assert.equal(r.json.route.mode, 'public');
  assert.equal((await hubReq('PUT', '/api/hub/publication', { service: 'nexarc', hote: 'carte.exemple.fr', cible: 'hub-nexarc:8090' })).status, 409);
  assert.ok(JSON.stringify(caddy.conf).includes('carte.exemple.fr'), 'Caddy a reçu la route');
  await relay.relais.sonderTout();
  const e = (await hubReq('GET', '/api/etat')).json;
  assert.equal(e.routes.find(x => x.hote === 'carte.exemple.fr').sante.ok, true);
});

test('noms locaux : chaque nom servi et chaque domaine de base mènent à la machine, quel que soit le domaine ; le tunnel reste au DNS public', async () => {
  const lire = () => fs.readFileSync(path.join(DNS, 'relay.hosts'), 'utf8');
  assert.equal((await hubReq('PUT', '/api/reglages/general', { domaines: ['mon-domaine.fr', 'exemple.fr'] })).status, 200);
  assert.match(lire(), /^192\.0\.2\.10 mon-domaine\.fr$/m, 'le domaine de base, aussitôt posé');
  assert.equal(fs.statSync(path.join(DNS, 'relay.hosts')).mode & 0o777, 0o644, 'lisible par le résolveur, malgré le masque 077 du processus');
  const r = await hubReq('PUT', '/api/hub/publication', { service: 'carnet', sousDomaine: 'carnet', cible: `127.0.0.1:${cible.address().port}` });
  assert.equal(r.json.url, 'https://carnet.mon-domaine.fr');
  assert.match(lire(), /^192\.0\.2\.10 carnet\.mon-domaine\.fr$/m, 'un nom publié mène à la machine');
  await hubReq('PUT', '/api/hub/publication', { service: 'portail', hote: 'portail.exemple.fr', cible: 'hub-portail:80', mode: 'cloudflare' });
  assert.doesNotMatch(lire(), /portail\.exemple\.fr/, 'une route du tunnel n’a pas de nom local');
  await hubReq('DELETE', '/api/hub/publication?service=carnet');
  assert.doesNotMatch(lire(), /carnet/, 'un nom retiré disparaît');
  await hubReq('DELETE', '/api/hub/publication?service=portail');
  assert.deepEqual(fs.readdirSync(DNS), ['relay.hosts'], 'aucun fichier intermédiaire ne reste');
  assert.equal(relay.relais.ecrireDns(), false, 'rien de changé : rien de réécrit');
  await hubReq('PUT', '/api/reglages/general', { domaines: ['exemple.fr'] });
});

test('domaines chez Cloudflare depuis le Hub : jeton écrit jamais relu, nom local → A vers la machine, certificat Let’s Encrypt, rien d’autre touché', async () => {
  assert.equal((await hubReq('PUT', '/api/hub/cloudflare', { jeton: 'cf-faux-jeton-0123456789abcdef' })).status, 400);
  assert.ok([401, 403].includes((await new Client(port).req('PUT', '/api/hub/cloudflare', { jeton: 'cf-jeton-de-test-0123456789abcdef' }, { origine: null })).status), 'sans le jeton du Hub, rien');
  assert.equal((await hubReq('PUT', '/api/hub/cloudflare', { jeton: 'cf-jeton-de-test-0123456789abcdef' }, 'un-autre-jeton-qui-n-est-pas-celui-du-hub')).status, 401, 'un faux jeton, refusé');
  let r = await hubReq('PUT', '/api/hub/cloudflare', { jeton: 'cf-jeton-de-test-0123456789abcdef' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.zones, ['exemple.fr']);
  assert.ok(!JSON.stringify((await hubReq('GET', '/api/etat')).json).includes('cf-jeton-de-test'), 'le jeton ne se relit pas');
  assert.deepEqual((await hubReq('GET', '/api/etat')).json.zonesCloudflare, ['exemple.fr']);

  r = await hubReq('PUT', '/api/hub/publication', { service: 'atelier', hote: 'atelier.exemple.fr', cible: `127.0.0.1:${cible.address().port}` });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const a = cf.dns.find(d => d.name === 'atelier.exemple.fr');
  assert.deepEqual({ ...a, id: undefined }, { id: undefined, type: 'A', name: 'atelier.exemple.fr', content: '192.0.2.10', proxied: false, ttl: 300, comment: 'géré par Relay' }, 'le nom mène à la machine, sans passer par Cloudflare');
  const pol = caddy.conf.apps.tls.automation.policies.find(p => p.subjects.includes('atelier.exemple.fr'));
  assert.equal(pol.issuers[0].challenges.dns.provider.name, 'cloudflare', 'certificat Let’s Encrypt par le défi DNS');
  assert.ok(!caddy.conf.apps.tls.automation.policies.some(p => p.issuers[0].module === 'internal' && p.subjects.includes('atelier.exemple.fr')));

  // Un enregistrement écrit par quelqu'un d'autre n'est jamais remplacé.
  cf.dns.push({ id: 'dx', type: 'A', name: 'perso.exemple.fr', content: '198.51.100.9', proxied: true });
  r = await hubReq('PUT', '/api/hub/publication', { service: 'perso', hote: 'perso.exemple.fr', cible: 'hub-perso:80' });
  assert.match(r.json.avertissement || '', /déjà un enregistrement A vers 198\.51\.100\.9/);
  assert.equal(cf.dns.find(d => d.id === 'dx').content, '198.51.100.9');
  await hubReq('DELETE', '/api/hub/publication?service=perso');
  assert.ok(cf.dns.find(d => d.id === 'dx'), 'retirer la route ne touche pas l’enregistrement d’un autre');

  // Un nom hors des zones du compte reste au résolveur de Relay.
  await hubReq('PUT', '/api/hub/publication', { service: 'local', hote: 'local.home.arpa', cible: 'hub-local:80' });
  assert.ok(!cf.dns.some(d => d.name === 'local.home.arpa'));
  await hubReq('DELETE', '/api/hub/publication?service=local');

  // Caddy arrêté pendant la connexion : le jeton reste, l'appel le dit sans erreur 500.
  caddy.refuser = 'atelier.exemple.fr';
  r = await hubReq('PUT', '/api/hub/cloudflare', { jeton: 'cf-jeton-de-test-0123456789abcdef' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.avertissement, /^Cloudflare est connecté, mais/);
  caddy.refuser = null;
  await relay.relais.appliquer();

  // Déconnecter : les enregistrements de Relay partent, les noms reviennent au certificat de Relay.
  r = await hubReq('DELETE', '/api/hub/cloudflare');
  assert.equal(r.status, 200);
  assert.ok(!cf.dns.some(d => d.name === 'atelier.exemple.fr'), 'l’enregistrement de Relay est effacé');
  assert.ok(caddy.conf.apps.tls.automation.policies.some(p => p.issuers[0].module === 'internal' && p.subjects.includes('atelier.exemple.fr')));
  assert.deepEqual((await hubReq('GET', '/api/etat')).json.zonesCloudflare, []);
  await hubReq('DELETE', '/api/hub/publication?service=atelier');
  cf.dns.splice(cf.dns.findIndex(d => d.id === 'dx'), 1);
});

test('Caddy arrêté : une panne en amont (502) dite en clair, et retenue dans l’état', async () => {
  const mort = new Caddy({ socket: path.join(tmp, 'absent.sock') });
  await assert.rejects(mort.charger({}), e => e.status === 502 && /Caddy est injoignable/.test(e.message));
  assert.equal(mort.dernier.ok, false);
  assert.match(mort.dernier.erreur, /injoignable/);
});

test('santé : la cible doit répondre en HTTP sans erreur serveur ; un port ouvert ne suffit pas', async () => {
  const p = cible.address().port;
  const ok = await relay.relais.sonde({ cible: `127.0.0.1:${p}`, hote: 'carte.exemple.fr' });
  assert.equal(ok.ok, true); assert.equal(ok.code, 200);
  const panne = await relay.relais.sonde({ cible: `127.0.0.1:${p}`, hote: 'panne.exemple.fr' });
  assert.equal(panne.ok, false, 'une 502 n’est pas « en ligne »'); assert.equal(panne.code, 502);
  const muet = net.createServer(s => s.end()); await new Promise(r => muet.listen(0, '127.0.0.1', r));
  const ouvert = await relay.relais.sonde({ cible: `127.0.0.1:${muet.address().port}`, hote: 'x.exemple.fr' });
  assert.equal(ouvert.ok, false, 'un port qui accepte puis ferme ne répond pas');
  muet.close();
  const ferme = await relay.relais.sonde({ cible: `127.0.0.1:${cibleMorte}`, hote: 'x.exemple.fr' });
  assert.deepEqual([ferme.ok, ferme.erreur], [false, 'connexion refusée']);
});

test('une écriture que Caddy refuse est défaite, et son message remonte tel quel', async () => {
  caddy.refuser = 'refuse.exemple.fr';
  const avant = (await admin.get('/api/etat')).json.routes.length;
  const r = await admin.post('/api/routes', { hote: 'refuse.exemple.fr', cible: 'hub-x:80', mode: 'local' });
  assert.equal(r.status, 502);
  assert.match(r.json.error, /refuse\.exemple\.fr refusé/);
  assert.equal((await admin.get('/api/etat')).json.routes.length, avant, 'rien ne reste en base');
  caddy.refuser = null;
  assert.ok(!JSON.stringify(caddy.conf).includes('refuse.exemple.fr'));
});

test('routes à la main : créer, mettre en pause, retirer ; une cible morte est signalée par Telegram', async () => {
  relay.socle.comptes.estRenforcee = () => false;
  assert.equal((await admin.put('/api/reglages/telegram', { jeton: '123456:jeton-telegram-de-test-abcdefgh', alertes: true })).status, 403, 'changer le bot exige un renfort');
  // Renfort : la clé d'accès de l'administrateur, comme dans l'interface.
  relay.socle.comptes.estRenforcee = () => true;
  let r = await admin.put('/api/reglages/telegram', { jeton: '123456:jeton-telegram-de-test-abcdefgh', alertes: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.jeton, true, 'le jeton ne redescend jamais');
  const brut = relay.db.prepare("SELECT valeur FROM reglages WHERE cle = 'telegram'").get().valeur;
  assert.ok(!brut.includes('jeton-telegram-de-test'), 'scellé en base');
  relay.magasin.poserReglage('telegram', { chat: '42' });

  r = await admin.post('/api/routes', { hote: 'stock.exemple.fr', cible: `127.0.0.1:${cibleMorte}`, mode: 'local' });
  assert.equal(r.status, 200);
  const id = r.json.route.id;
  relay.relais.sante.set(id, { ok: true, ms: 1, at: Date.now() });
  await relay.relais.sonderTout();
  for (let i = 0; i < 50 && !tg.messages.some(m => /stock.exemple\.fr ne répond plus/.test(m.text)); i++) await new Promise(r => setTimeout(r, 20));
  assert.ok(tg.messages.some(m => /stock.exemple\.fr ne répond plus/.test(m.text) && m.chat_id === '42'), JSON.stringify(tg.messages));
  r = await admin.patch(`/api/routes/${id}`, { actif: false });
  assert.equal(r.json.route.actif, false);
  assert.ok(!JSON.stringify(caddy.conf).includes('stock.exemple.fr'), 'en pause : plus servie');
  assert.equal((await admin.del(`/api/routes/${id}`)).status, 200);
  assert.equal((await admin.del(`/api/routes/${id}`)).status, 404);
  delete relay.socle.comptes.estRenforcee;
});

test('Telegram : un chat se lie par le code affiché, un autre code ne lie rien', async () => {
  relay.socle.comptes.estRenforcee = () => true;
  relay.magasin.poserReglage('telegram', { chat: '' });
  const o = await admin.post('/api/telegram/lier');
  assert.equal(o.status, 200, JSON.stringify(o.json));
  await relay.telegram.recevoir('99', '/lier 000000' === `/lier ${o.json.code}` ? '/lier 111111' : '/lier 000000');
  assert.equal(relay.magasin.reglage('telegram').chat, '');
  await relay.telegram.recevoir('77', `/lier ${o.json.code}`);
  assert.equal(relay.magasin.reglage('telegram').chat, '77');
  relay.telegram.arreter();
  delete relay.socle.comptes.estRenforcee;
});

test('services raccordés : jeton montré une fois, portée « soi » bornée à ses routes, révocation qui emporte ses routes', async () => {
  relay.socle.comptes.estRenforcee = () => false;
  assert.equal((await admin.post('/api/clients', { nom: 'carte' })).status, 403, 'renfort exigé');
  relay.socle.comptes.estRenforcee = () => true;
  const c = await admin.post('/api/clients', { nom: 'carte' });
  assert.equal(c.status, 200);
  const jeton = c.json.jeton;
  assert.match(jeton, /^svc_/);
  assert.equal((await admin.get('/api/clients')).json.clients[0].jeton, undefined, 'seule l’empreinte reste');
  const svc = (m, ch, b) => new Client(port).req(m, ch, b, { entetes: { 'x-relay-key': jeton }, origine: null });
  let r = await svc('POST', '/api/register', { subdomain: 'plan', upstream: `127.0.0.1:${cible.address().port}`, mode: 'local' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.created, r.json.url, r.json.route.tls], [true, 'https://plan.exemple.fr', 'internal']);
  r = await svc('POST', '/api/register', { subdomain: 'plan', upstream: `127.0.0.1:${cible.address().port}`, mode: 'local' });
  assert.equal(r.json.updated, true);
  assert.equal((await svc('POST', '/api/register', { host: 'carte.exemple.fr', upstream: 'x:80' })).status, 409, 'le nom d’un autre');
  assert.equal((await svc('GET', '/api/whoami')).json.routes.length, 1);
  assert.equal((await svc('GET', '/api/etat')).status, 403, 'portée « soi » : pas les autres routes');
  assert.equal((await svc('GET', '/api/reglages')).status, 401);
  const rot = await admin.post(`/api/clients/${c.json.client.id}/tourner`);
  assert.equal((await svc('GET', '/api/whoami')).status, 401, 'l’ancien jeton ne vaut plus');
  const svc2 = (m, ch, b) => new Client(port).req(m, ch, b, { entetes: { authorization: `Bearer ${rot.json.jeton}` }, origine: null });
  assert.equal((await svc2('GET', '/api/whoami')).json.routes.length, 1, 'les routes restent');
  assert.equal((await admin.del(`/api/clients/${c.json.client.id}`)).json.routes, 1);
  assert.ok(!(await admin.get('/api/etat')).json.routes.some(x => x.hote === 'plan.exemple.fr'));
  delete relay.socle.comptes.estRenforcee;
});

test('Cloudflare : jeton vérifié puis scellé, ingress et CNAME posés pour une route du tunnel, rien d’autre touché', async () => {
  relay.socle.comptes.estRenforcee = () => true;
  assert.equal((await admin.put('/api/reglages/cloudflare', { jeton: 'cf-faux-jeton-0123456789abcdef' })).status, 400, 'un jeton refusé est une saisie à corriger');
  const e = await admin.post('/api/cloudflare/essai', { jeton: 'cf-jeton-de-test-0123456789abcdef' });
  assert.equal(e.json.comptes[0].tunnels[0].nom, 'maison');
  let r = await admin.put('/api/reglages/cloudflare', { jeton: 'cf-jeton-de-test-0123456789abcdef', compte: 'a1b2c3', nomCompte: 'Labo', tunnel: '11111111-2222-3333-4444-555555555555', nomTunnel: 'maison', actif: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.jeton, true);
  r = await admin.post('/api/routes', { hote: 'public.exemple.fr', cible: `127.0.0.1:${cible.address().port}`, mode: 'public', cf: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.route.mode, 'clair');
  assert.deepEqual(cf.ingress.map(x => x.hostname || x.service), ['autre.exemple.fr', 'public.exemple.fr', 'http_status:404'], 'l’entrée d’un autre et le repli sont gardés');
  assert.equal(cf.ingress[1].service, 'http://relay-caddy:80');
  const { id: _id, ...cname } = cf.dns.find(d => d.name === 'public.exemple.fr');
  assert.deepEqual(cname, { type: 'CNAME', name: 'public.exemple.fr', content: '11111111-2222-3333-4444-555555555555.cfargotunnel.com', proxied: true, ttl: 1 });
  // Un enregistrement qui n'est pas un tunnel n'est jamais remplacé.
  cf.dns.push({ type: 'A', name: 'site.exemple.fr', content: '198.51.100.7' });
  r = await admin.post('/api/routes', { hote: 'site.exemple.fr', cible: 'hub-x:80', mode: 'clair', cf: true });
  assert.match(r.json.avertissement, /déjà un enregistrement A/);
  assert.equal(cf.dns.find(d => d.name === 'site.exemple.fr').content, '198.51.100.7');
  const ap = await admin.post('/api/cloudflare/apercu', { hote: 'nouveau.exemple.fr' });
  const ecritures = cf.ecritures;
  assert.equal(ap.json.apres.length, ap.json.avant.length + 1);
  assert.equal(cf.ecritures, ecritures, 'l’aperçu n’écrit rien');
  delete relay.socle.comptes.estRenforcee;
});

test('Caddy redémarré sans sa configuration : elle lui est rendue au tour suivant', async () => {
  caddy.conf = null;
  assert.equal(await relay.relais.reconcilier(), true);
  assert.ok(JSON.stringify(caddy.conf).includes('carte.exemple.fr'));
  assert.equal(await relay.relais.reconcilier(), false, 'à jour : rien à pousser');
});

test('certificat local téléchargeable ; configuration lisible par l’admin seul', async () => {
  const r = await membre.get('/api/autorite');
  assert.equal(r.status, 200);
  assert.match(r.entetes['content-disposition'], /relay-autorite\.crt/);
  assert.match(r.texte, /BEGIN CERTIFICATE/);
  assert.equal((await membre.get('/api/configuration')).status, 403);
  assert.equal((await admin.get('/api/configuration')).json.admin.listen, `unix/${SOCKET}|0666`);
});

test('reprise d’un Relay 1.x : routes, services (jetons toujours valables) et réglages, secrets scellés', async () => {
  const { ouvrirBase, Magasin, empreinte } = await import('../src/base.js');
  const { reprendre } = await import('../src/reprise.js');
  const { Coffre, Journal } = await import('../socle/src/index.js');
  const d = fs.mkdtempSync(path.join(tmp, 'reprise-'));
  fs.writeFileSync(path.join(d, 'routes.json'), JSON.stringify({ routes: [
    { id: 'r1', name: 'Carte', host: 'carte.exemple.fr', upstream: '192.0.2.20:8090', tls: 'internal', enabled: true, owner: 'c1' },
    { id: 'r2', host: 'pve.exemple.fr', upstream: 'https://192.0.2.30:8006', tls: 'auto', verify: false },
    { id: 'r3', host: 'dyn.exemple.fr', upstream: 'docker://portainer:9000', tls: 'auto' },
  ] }));
  fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify({
    general: { domains: ['exemple.fr'], acmeEmail: 'ops@exemple.fr', probeMs: 20000 },
    telegram: { token: '123:abc', chat: '42', alerts: true, commands: true },
    cloudflare: { token: 'cf-ancien', accountId: 'acc', tunnelId: 'tun', enabled: true },
    clients: [{ id: 'c1', name: 'carte', scope: 'own', tokenHash: empreinte('svc_ancien'), hint: '…cien', created: 1 }],
  }));
  const db = ouvrirBase(path.join(d, 'base'));
  const coffre = new Coffre({ cle: Buffer.alloc(32, 7).toString('base64'), fichier: path.join(d, 'k') });
  const m = new Magasin(db, { coffre });
  const bilan = reprendre({ dossier: d, db, magasin: m, journal: new Journal(db), log: silence });
  assert.deepEqual([bilan.routes, bilan.clients, bilan.ignorees], [2, 1, ['dyn.exemple.fr']]);
  assert.equal(m.routeParHote('carte.exemple.fr').mode, 'local');
  assert.equal(m.routeParHote('pve.exemple.fr').mode, 'public');
  assert.equal(m.clientParJeton('svc_ancien').nom, 'carte', 'le jeton de la 1.x vaut toujours');
  assert.equal(m.routeParHote('carte.exemple.fr').client, m.clientParJeton('svc_ancien').id);
  assert.equal(m.secret('telegram', 'jeton'), '123:abc');
  assert.ok(!db.prepare("SELECT valeur FROM reglages WHERE cle = 'cloudflare'").get().valeur.includes('cf-ancien'));
  assert.equal(m.reglage('general').sondeSecondes, 20);
  assert.equal(reprendre({ dossier: d, db, magasin: m, journal: new Journal(db), log: silence }), null, 'une seule fois');
  db.close();
});

test('Cloudflare : une règle joker couvre déjà le nom, l’ingress ne bouge pas', () => {
  const regles = [{ hostname: '*.exemple.fr', service: 'x' }, { service: 'http_status:404' }];
  assert.equal(Cloudflare.joker(regles, 'a.exemple.fr').hostname, '*.exemple.fr');
  assert.equal(Cloudflare.joker(regles, 'exemple.fr'), undefined);
});

test('autorisation : chaque route balayée sans session, en lecture seule, et avec un jeton de service « soi »', async () => {
  relay.socle.comptes.estRenforcee = () => true;
  const c = await admin.post('/api/clients', { nom: 'balayage' });
  delete relay.socle.comptes.estRenforcee;
  const svc = (m, ch, b) => new Client(port).req(m, ch, b, { entetes: { 'x-relay-key': c.json.jeton }, origine: null });
  const ROLE = { lecture: 0, membre: 1, admin: 2 };
  for (const r of relay.api.routeur.routes) {
    const chemin = r.re.source.slice(1, -1).replace(/\\\//g, '/').replace('([^/]+)', 'AAAAAAAAAAAA');
    const corps = r.methode === 'GET' || r.methode === 'DELETE' ? undefined : {};
    const anonyme = await new Client(port).req(r.methode, chemin, corps);
    if (r.options.public) assert.ok(anonyme.status < 500, `${r.methode} ${chemin} public → ${anonyme.status}`);
    else assert.ok([401, 403].includes(anonyme.status), `${r.methode} ${chemin} sans session → ${anonyme.status}`);
    if (!r.options.public && ROLE[r.options.role] > ROLE.lecture) {
      const lu = await membre.req(r.methode, chemin, corps);
      assert.equal(lu.status, 403, `${r.methode} ${chemin} en lecture seule → ${lu.status}`);
    }
    if (!r.options.public && !['/api/whoami', '/api/heartbeat', '/api/register'].includes(chemin)) {
      const s = await svc(r.methode, chemin, corps);
      assert.ok([401, 403].includes(s.status), `${r.methode} ${chemin} avec un jeton « soi » → ${s.status}`);
    }
  }
});
