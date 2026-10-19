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

// Un faux Caddy : il garde la configuration reçue, refuse celle qu'on lui dit de refuser.
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

const cf = { ingress: [{ hostname: 'autre.exemple.fr', service: 'http://ailleurs:80' }, { service: 'http_status:404' }], dns: [], ecritures: 0, n: 0, crees: [] };
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
    if (u.pathname === '/cf/accounts/a1b2c3/cfd_tunnel') {
      if (req.method === 'POST') { const b = JSON.parse(corps); cf.crees.push(b); return ok({ id: '99999999-8888-7777-6666-555555555555', name: b.name }); }
      return ok([{ id: '11111111-2222-3333-4444-555555555555', name: 'maison' }, ...cf.crees.map(b => ({ id: '99999999-8888-7777-6666-555555555555', name: b.name }))]);
    }
    if (/^\/cf\/accounts\/a1b2c3\/cfd_tunnel\/[0-9a-f-]{36}\/token$/.test(u.pathname)) return ok('eyJhIjoiYTFiMmMzIiwidCI6InR1bm5lbCJ9');
    if (u.pathname.endsWith('/configurations')) {
      if (req.method === 'PUT') { cf.ecritures++; cf.ingress = JSON.parse(corps).config.ingress; return ok({}); }
      return ok({ config: { ingress: cf.ingress } });
    }
    if (u.pathname === '/cf/zones') return ok([{ id: 'z1', name: 'exemple.fr', account: { id: 'a1b2c3', name: 'Labo' } }]);
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

test('base : dossier en 0700, base et journaux WAL en 0600, même sous un masque permissif (ligne de commande)', async () => {
  const { ouvrirBase } = await import('../src/base.js');
  const d = path.join(fs.mkdtempSync(path.join(tmp, 'droits-')), 'data');
  const masque = process.umask(0o022);
  try {
    const db = ouvrirBase(d);
    db.exec('CREATE TABLE t(x); INSERT INTO t VALUES (1);');
    db.close();
    const db2 = ouvrirBase(d);
    assert.equal(fs.statSync(d).mode & 0o777, 0o700);
    for (const f of ['relay.db', 'relay.db-wal', 'relay.db-shm']) if (fs.existsSync(path.join(d, f))) assert.equal(fs.statSync(path.join(d, f)).mode & 0o777, 0o600, f);
    db2.close();
  } finally { process.umask(masque); }
});

test('configuration de Caddy : 80 redirige, 443 sert, un certificat par mode, l’API sur le socket', () => {
  const conf = construire([
    { hote: 'a.exemple.fr', cible: 'hub-a:8090', mode: 'local', actif: true },
    { hote: 'b.exemple.fr', cible: 'https://192.0.2.20:8443', mode: 'public', actif: true, verifier: false },
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
    { hote: 'cave.home.arpa', cible: 'hub-n:80', mode: 'local', actif: true },
  ], { socket: '/s', cloudflare: { zones: ['exemple.fr'], jeton: 'jeton-cf' } });
  assert.deepEqual(avecCf.apps.tls.automation.policies, [
    { subjects: ['a.exemple.fr'], issuers: [{ module: 'acme', challenges: { dns: { provider: { name: 'cloudflare', api_token: 'jeton-cf' }, resolvers: ['1.1.1.1:53', '1.0.0.1:53'] } } }] },
    { subjects: ['cave.home.arpa'], issuers: [{ module: 'internal' }] },
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
  const echecs = () => relay.socle.limiteur.lire('ip:machine:127.0.0.1').echecs;
  const avant = echecs();
  assert.equal((await hubReq('GET', '/api/etat', undefined, 'faux-jeton-faux-jeton-faux-jeton')).status, 401);
  assert.equal(echecs(), avant + 1, 'le jeton faux compte pour l’adresse, dans le limiteur persistant');
  relay.db.prepare("DELETE FROM socle_essais WHERE cle = 'ip:machine:127.0.0.1'").run();
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

test('tunnel depuis le Hub : compte des zones, tunnel choisi ou créé, jeton du connecteur rendu au Hub, une route locale passe au tunnel', async () => {
  assert.equal((await hubReq('PUT', '/api/hub/cloudflare/tunnel', { nom: 'hub-test' })).status, 409, 'sans jeton d’API, rien');
  assert.deepEqual((await hubReq('GET', '/api/hub/cloudflare/tunnel')).json, { connecte: false, actif: false, tunnels: [] });
  assert.equal((await hubReq('PUT', '/api/hub/cloudflare', { jeton: 'cf-jeton-de-test-0123456789abcdef' })).status, 200);
  let r = await hubReq('GET', '/api/hub/cloudflare/tunnel');
  assert.deepEqual([r.json.connecte, r.json.actif, r.json.compte.id, r.json.tunnels[0].nom], [true, false, 'a1b2c3', 'maison']);
  assert.equal((await hubReq('PUT', '/api/hub/cloudflare/tunnel', {})).status, 400, 'ni tunnel ni nom');
  assert.equal((await hubReq('PUT', '/api/hub/cloudflare/tunnel', { tunnel: '00000000-0000-0000-0000-000000000000' })).status, 404);
  assert.ok([401, 403].includes((await new Client(port).req('PUT', '/api/hub/cloudflare/tunnel', { nom: 'x' }, { origine: null })).status), 'sans le jeton du Hub, rien');

  // Une route locale d'abord : son enregistrement A mène à la machine.
  r = await hubReq('PUT', '/api/hub/publication', { service: 'veille', hote: 'veille.exemple.fr', cible: `127.0.0.1:${cible.address().port}` });
  assert.equal(cf.dns.find(d => d.name === 'veille.exemple.fr').type, 'A');

  r = await hubReq('PUT', '/api/hub/cloudflare/tunnel', { nom: 'hub-test' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(cf.crees.length, 1, 'un tunnel créé');
  assert.equal(cf.crees[0].config_src, 'cloudflare', 'géré par Cloudflare : son ingress se règle par l’API');
  assert.ok(Buffer.from(cf.crees[0].tunnel_secret, 'base64').length === 32);
  assert.deepEqual([r.json.tunnel.nom, r.json.jeton], ['hub-test', 'eyJhIjoiYTFiMmMzIiwidCI6InR1bm5lbCJ9']);
  r = await hubReq('GET', '/api/hub/cloudflare/tunnel');
  assert.deepEqual([r.json.actif, r.json.tunnel.nom], [true, 'hub-test']);
  assert.ok(!JSON.stringify((await hubReq('GET', '/api/etat')).json).includes('eyJhIjoi'), 'le jeton du connecteur ne se relit pas');

  // La route passe au tunnel : l'A part avant que le CNAME ne prenne le nom.
  r = await hubReq('PUT', '/api/hub/publication', { service: 'veille', hote: 'veille.exemple.fr', cible: `127.0.0.1:${cible.address().port}`, mode: 'cloudflare' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(!r.json.avertissement, r.json.avertissement);
  const recs = cf.dns.filter(d => d.name === 'veille.exemple.fr');
  assert.deepEqual(recs.map(d => [d.type, d.content, d.proxied]), [['CNAME', '99999999-8888-7777-6666-555555555555.cfargotunnel.com', true]]);
  assert.ok(cf.ingress.some(x => x.hostname === 'veille.exemple.fr'));

  await hubReq('DELETE', '/api/hub/publication?service=veille');
  assert.ok(!cf.dns.some(d => d.name === 'veille.exemple.fr'), 'retirée, son CNAME part');
  assert.deepEqual((await hubReq('DELETE', '/api/hub/cloudflare/tunnel')).json, { actif: false });
  assert.equal((await hubReq('GET', '/api/hub/cloudflare/tunnel')).json.actif, false);
  await hubReq('DELETE', '/api/hub/cloudflare');
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

test('Telegram : un chat se lie par le code affiché, un autre code ne lie rien ; seul le chat lié commande', async () => {
  relay.socle.comptes.estRenforcee = () => true;
  relay.magasin.poserReglage('telegram', { chat: '' });
  const o = await admin.post('/api/telegram/lier');
  assert.equal(o.status, 200, JSON.stringify(o.json));
  await relay.telegram.recevoir('99', '/lier 000000' === `/lier ${o.json.code}` ? '/lier 111111' : '/lier 000000');
  assert.equal(relay.magasin.reglage('telegram').chat, '');
  await relay.telegram.recevoir('77', `/lier ${o.json.code}`);
  assert.equal(relay.magasin.reglage('telegram').chat, '77');
  // Commandes actives : seul le chat lié est écouté.
  relay.magasin.poserReglage('telegram', { commandes: true });
  const pause = await admin.post('/api/routes', { hote: 'pause.exemple.fr', cible: 'hub-pause:80', mode: 'local' });
  await relay.telegram.recevoir('78', '/pause pause.exemple.fr');
  assert.equal(relay.magasin.route(pause.json.route.id).actif, true, 'un autre chat ne commande rien');
  await relay.telegram.recevoir('77', '/pause pause.exemple.fr');
  assert.equal(relay.magasin.route(pause.json.route.id).actif, false, 'le chat lié, oui');
  relay.magasin.poserReglage('telegram', { commandes: false });
  await admin.del(`/api/routes/${pause.json.route.id}`);
  // Cinq codes faux, d'où qu'ils viennent : le code affiché ne lie plus rien.
  relay.magasin.poserReglage('telegram', { chat: '' });
  const l = await admin.post('/api/telegram/lier');
  const faux = String((Number(l.json.code) + 1) % 1e6).padStart(6, '0');
  for (let i = 0; i < 5; i++) await relay.telegram.recevoir(String(500 + i), `/lier ${faux}`);
  await relay.telegram.recevoir('66', `/lier ${l.json.code}`);
  assert.equal(relay.magasin.reglage('telegram').chat, '', 'le bon code arrive trop tard');
  assert.ok(relay.db.prepare("SELECT 1 FROM socle_journal WHERE action = 'telegram.liaison_annulee'").get());
  const l2 = await admin.post('/api/telegram/lier');
  for (let i = 0; i < 4; i++) await relay.telegram.recevoir('501', '/lier abcdef');
  await relay.telegram.recevoir('66', `/lier ${l2.json.code}`);
  assert.equal(relay.magasin.reglage('telegram').chat, '66', 'un nouveau code repart de zéro');
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
  for (const upstream of ['127.0.0.1:8095', 'localhost:2019', '169.254.169.254:80', '0.0.0.0:80', '127.1:80', '0x7f000001:80', '2130706433:80', 'https://LOCALHOST:443']) {
    assert.equal((await svc('POST', '/api/register', { subdomain: 'plan', upstream, mode: 'local' })).status, 400, upstream);
  }
  assert.ok(!relay.magasin.routeParHote('plan.exemple.fr'), 'rien de posé');
  let r = await svc('POST', '/api/register', { subdomain: 'plan', upstream: '192.0.2.20:8090', mode: 'local' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(relay.db.prepare("SELECT details FROM socle_journal WHERE action = 'register.cree' ORDER BY n DESC").get().details.includes('192.0.2.20:8090'), 'la cible est au journal');
  assert.deepEqual([r.json.created, r.json.url, r.json.route.tls], [true, 'https://plan.exemple.fr', 'internal']);
  r = await svc('POST', '/api/register', { subdomain: 'plan', upstream: '192.0.2.20:8090', mode: 'local' });
  assert.equal(r.json.updated, true);
  assert.equal((await svc('POST', '/api/register', { subdomain: 'plan', upstream: '127.0.0.1:8095', mode: 'local' })).status, 400, 'pas plus en mise à jour');
  assert.equal(relay.magasin.routeParHote('plan.exemple.fr').cible, '192.0.2.20:8090');
  r = await svc('POST', '/api/register', { host: 'carte.exemple.fr', upstream: 'x:80' });
  assert.equal(r.status, 409, 'le nom d’un autre');
  assert.equal(r.json.error, 'carte.exemple.fr is already routed by another service.', 'le message du contrat (INTEGRATION.md)');
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
  assert.deepEqual(cname, { type: 'CNAME', name: 'public.exemple.fr', content: '11111111-2222-3333-4444-555555555555.cfargotunnel.com', proxied: true, ttl: 1, comment: 'géré par Relay' });
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

test('Cloudflare : le nom qu’un autre tient dans le tunnel ou le DNS n’est ni pris ni retiré', async () => {
  relay.socle.comptes.estRenforcee = () => true;
  const ingress = cf.ingress.length;
  cf.ingress.splice(-1, 0, { hostname: 'tenu.exemple.fr', service: 'https://192.0.2.40:8443' });
  cf.dns.push({ id: 'autre1', type: 'CNAME', name: 'tenu.exemple.fr', content: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.cfargotunnel.com', proxied: true });
  cf.dns.push({ id: 'autre2', type: 'CNAME', name: 'cam.exemple.fr', content: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.cfargotunnel.com', proxied: true });
  const avant = JSON.stringify([cf.ingress, cf.dns]);
  let r = await admin.post('/api/routes', { hote: 'tenu.exemple.fr', cible: 'hub-x:80', mode: 'clair', cf: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.avertissement, /déjà une entrée dans le tunnel/);
  const tenu = r.json.route.id;
  r = await admin.post('/api/routes', { hote: 'cam.exemple.fr', cible: 'hub-x:80', mode: 'clair', cf: true });
  assert.match(r.json.avertissement, /déjà un enregistrement CNAME/);
  const cam = r.json.route.id;
  assert.equal(JSON.stringify([cf.ingress.filter(x => x.hostname !== 'cam.exemple.fr'), cf.dns]), avant, 'rien de l’autre n’a bougé');
  await admin.del(`/api/routes/${tenu}`);
  await admin.del(`/api/routes/${cam}`);
  assert.equal(JSON.stringify([cf.ingress, cf.dns]), avant, 'ni retiré en partant');
  cf.ingress = cf.ingress.filter(x => x.hostname !== 'tenu.exemple.fr');
  cf.dns = cf.dns.filter(d => !String(d.id).startsWith('autre'));
  assert.equal(cf.ingress.length, ingress);
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

test('configuration lue par l’admin : le jeton Cloudflare du défi DNS n’en sort pas', async () => {
  relay.magasin.poserSecret('cloudflare', 'jeton', 'cf-jeton-de-test-0123456789abcdef');
  relay.magasin.poserReglage('cloudflare', { zones: ['exemple.fr'] });
  const r = await admin.post('/api/routes', { hote: 'tenu.exemple.fr', cible: 'hub-tenu:80', mode: 'local' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(JSON.stringify(relay.relais.configuration()).includes('cf-jeton-de-test'), 'Caddy, lui, le reçoit');
  const c = await admin.get('/api/configuration');
  assert.equal(c.status, 200);
  assert.ok(!c.texte.includes('cf-jeton-de-test'), 'il ne redescend pas');
  assert.equal(c.json.apps.tls.automation.policies.find(p => p.subjects.includes('tenu.exemple.fr')).issuers[0].challenges.dns.provider.api_token, '(scellé)');
  await admin.del(`/api/routes/${r.json.route.id}`);
});

test('reprise d’un Relay 1.x : routes, services (jetons toujours valables) et réglages, secrets scellés', async () => {
  const { ouvrirBase, Magasin, empreinte } = await import('../src/base.js');
  const { reprendre } = await import('../src/reprise.js');
  const { Coffre, Journal } = await import('../socle/src/index.js');
  const d = fs.mkdtempSync(path.join(tmp, 'reprise-'));
  fs.writeFileSync(path.join(d, 'routes.json'), JSON.stringify({ routes: [
    { id: 'r1', name: 'Carte', host: 'carte.exemple.fr', upstream: '192.0.2.20:8090', tls: 'internal', enabled: true, owner: 'c1' },
    { id: 'r2', host: 'console.exemple.fr', upstream: 'https://192.0.2.30:8443', tls: 'auto', verify: false },
    { id: 'r3', host: 'dyn.exemple.fr', upstream: 'docker://portainer:9000', tls: 'auto' },
    { id: 'r4', host: 'entete.exemple.fr', upstream: '192.0.2.21:80', tls: 'auto', hostHeader: 'a b\r\nX-Injecte: 1' },
    { id: 'r5', host: 'port.exemple.fr', upstream: '192.0.2.22:99999', tls: 'auto' },
  ] }));
  fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify({
    general: { domains: ['exemple.fr'], acmeEmail: 'ops@exemple.fr', probeMs: 20000 },
    telegram: { token: '123:abc', chat: '42', alerts: true, commands: true },
    cloudflare: { token: 'cf-ancien', accountId: 'acc', tunnelId: 'tun', enabled: true },
    clients: [{ id: 'c1', name: 'carte', scope: 'own', tokenHash: empreinte('svc_ancien'), hint: '…cien', created: 1 },
      { id: 'c2', name: 'Nom <b>libre</b>', scope: 'routes', tokenHash: empreinte('svc_autre'), created: 1 }],
  }));
  const db = ouvrirBase(path.join(d, 'base'));
  const coffre = new Coffre({ cle: Buffer.alloc(32, 7).toString('base64'), fichier: path.join(d, 'k') });
  const m = new Magasin(db, { coffre });
  const bilan = reprendre({ dossier: d, db, magasin: m, journal: new Journal(db), log: silence });
  assert.deepEqual([bilan.routes, bilan.clients, bilan.ignorees], [2, 1, ['dyn.exemple.fr', 'entete.exemple.fr', 'port.exemple.fr']], 'contrôlées comme une saisie');
  assert.equal(m.clientParJeton('svc_autre'), null, 'un nom de service hors du motif n’est pas repris');
  assert.equal(m.routeParHote('carte.exemple.fr').mode, 'local');
  assert.equal(m.routeParHote('console.exemple.fr').mode, 'public');
  assert.equal(m.clientParJeton('svc_ancien').nom, 'carte', 'le jeton de la 1.x vaut toujours');
  assert.equal(m.routeParHote('carte.exemple.fr').client, m.clientParJeton('svc_ancien').id);
  assert.equal(m.secret('telegram', 'jeton'), '123:abc');
  assert.ok(!db.prepare("SELECT valeur FROM reglages WHERE cle = 'cloudflare'").get().valeur.includes('cf-ancien'));
  assert.equal(m.reglage('general').sondeSecondes, 20);
  assert.equal(reprendre({ dossier: d, db, magasin: m, journal: new Journal(db), log: silence }), null, 'une seule fois');
  db.close();
  // Un dossier vide ou un fichier illisible : le démarrage s'arrête, rien n'est marqué repris.
  const vide = fs.mkdtempSync(path.join(tmp, 'reprise-vide-')), casse = fs.mkdtempSync(path.join(tmp, 'reprise-casse-'));
  fs.writeFileSync(path.join(casse, 'settings.json'), '{"general": ');
  for (const [dossier, motif] of [[vide, /ni routes\.json ni settings\.json/], [casse, /settings\.json illisible/]]) {
    const b = ouvrirBase(path.join(dossier, 'base'));
    const mb = new Magasin(b, { coffre });
    assert.throws(() => reprendre({ dossier, db: b, magasin: mb, journal: new Journal(b), log: silence }), motif);
    assert.equal(mb.reglage('general').repris, undefined, 'rien de marqué : la reprise se refera');
    b.close();
  }
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

test('autorisation : un jeton « routes » gère les routes, ni les réglages ni Cloudflare ; le jeton du Hub ni les comptes, ni les jetons de services, ni Telegram', async () => {
  relay.socle.comptes.estRenforcee = () => true;
  const c = await admin.post('/api/clients', { nom: 'gestionnaire', portee: 'routes' });
  delete relay.socle.comptes.estRenforcee;
  const svc = (m, ch, b) => new Client(port).req(m, ch, b, { entetes: { 'x-relay-key': c.json.jeton }, origine: null });
  const PERMIS = new Set(['GET /api/etat', 'POST /api/routes', 'PATCH /api/routes/AAAAAAAAAAAA', 'DELETE /api/routes/AAAAAAAAAAAA',
    'POST /api/routes/AAAAAAAAAAAA/sonder', 'POST /api/appliquer', 'GET /api/autorite', 'GET /api/whoami', 'POST /api/heartbeat', 'POST /api/register', 'DELETE /api/register']);
  for (const r of relay.api.routeur.routes) {
    const chemin = r.re.source.slice(1, -1).replace(/\\\//g, '/').replace('([^/]+)', 'AAAAAAAAAAAA');
    if (r.options.public && chemin === '/api/health') continue;
    const s = await svc(r.methode, chemin, r.methode === 'GET' || r.methode === 'DELETE' ? undefined : {});
    if (PERMIS.has(`${r.methode} ${chemin}`)) assert.ok(![401, 403].includes(s.status), `${r.methode} ${chemin} → ${s.status}`);
    else assert.ok([401, 403].includes(s.status), `${r.methode} ${chemin} avec un jeton « routes » → ${s.status}`);
  }
  assert.equal((await svc('PUT', '/api/reglages/general', { domaines: ['ailleurs.fr'] })).status, 403);
  assert.equal((await svc('POST', '/api/routes', { hote: 'meta.exemple.fr', cible: '169.254.169.254:80' })).status, 400, 'pas la machine non plus');
  const r = await svc('POST', '/api/routes', { hote: 'geree.exemple.fr', cible: 'hub-geree:80' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await svc('PATCH', `/api/routes/${r.json.route.id}`, { cible: '127.0.0.1:8095' })).status, 400);
  assert.equal((await admin.patch(`/api/routes/${r.json.route.id}`, { cible: '127.0.0.1:8095' })).status, 200, 'l’administrateur, lui, choisit');
  await admin.del(`/api/routes/${r.json.route.id}`);
  assert.deepEqual(relay.magasin.reglage('general').domaines, ['exemple.fr'], 'les domaines de base ne bougent pas');
  // Le jeton du Hub : les routes, la publication, les domaines et Cloudflare ; ni les comptes, ni les jetons de services, ni Telegram.
  const HUB_PERMIS = new Set([...PERMIS].filter(x => !/whoami|heartbeat|register/.test(x)).concat(['PUT /api/reglages/general', 'PUT /api/hub/publication', 'DELETE /api/hub/publication',
    'PUT /api/hub/cloudflare', 'DELETE /api/hub/cloudflare', 'GET /api/hub/cloudflare/tunnel', 'PUT /api/hub/cloudflare/tunnel', 'DELETE /api/hub/cloudflare/tunnel', 'POST /api/cloudflare/apercu', 'POST /api/cloudflare/synchroniser']));
  for (const r of relay.api.routeur.routes) {
    const chemin = r.re.source.slice(1, -1).replace(/\\\//g, '/').replace('([^/]+)', 'AAAAAAAAAAAA');
    if (r.options.public && chemin === '/api/health') continue;
    if (HUB_PERMIS.has(`${r.methode} ${chemin}`)) continue;
    const s = await hubReq(r.methode, chemin, r.methode === 'GET' || r.methode === 'DELETE' ? undefined : {});
    assert.ok([401, 403].includes(s.status), `${r.methode} ${chemin} avec le jeton du Hub → ${s.status}`);
  }
});

test('ligne de commande : sauvegarde chiffrée pour une clé publique, restaurée ailleurs ; secrets retirés pour un incident, Caddy suit', async () => {
  const { execFile } = await import('node:child_process');
  const { DatabaseSync } = await import('node:sqlite');
  const crypto = await import('node:crypto');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  // Asynchrone : le faux Caddy vit dans ce processus et doit pouvoir répondre.
  const cli = (args, entree = '') => new Promise((ok, ko) => {
    const p = execFile(process.execPath, ['--disable-warning=ExperimentalWarning', path.resolve(import.meta.dirname, '..', 'src', 'cli.js'), ...args],
      { encoding: 'buffer', env: { PATH: process.env.PATH, DATA_DIR: path.join(tmp, 'data'), RELAY_HUB_TOKEN: JETON_HUB, RELAY_CADDY_SOCKET: SOCKET, RELAY_IP: '192.0.2.10', RELAY_DNS_DIR: DNS } },
      (e, stdout, stderr) => (e ? ko(Object.assign(e, { stderr })) : ok(stdout)));
    p.stdin.end(entree);
  });
  relay.magasin.poserSecret('telegram', 'jeton', '123456:jeton-telegram-de-test-abcdefgh');
  relay.magasin.poserSecret('cloudflare', 'jeton', 'cf-jeton-de-test-0123456789abcdef');
  relay.magasin.poserReglage('cloudflare', { zones: ['exemple.fr'] });
  const r = await admin.post('/api/routes', { hote: 'coffre.exemple.fr', cible: 'hub-coffre:80', mode: 'local' });
  assert.ok(JSON.stringify(caddy.conf).includes('cf-jeton-de-test'), 'Caddy porte le jeton du défi DNS');
  const sauv = await cli(['sauvegarde'], publicKey);
  assert.ok(!sauv.includes(Buffer.from('SQLite format')), 'la sauvegarde est chiffrée');
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-restaure-'));
  try {
    const pem = path.join(dossier, 'cle.pem');
    fs.writeFileSync(pem, privateKey, { mode: 0o600 });
    await cli(['restaurer', pem, path.join(dossier, 'relay.db')], sauv);
    const copie = new DatabaseSync(path.join(dossier, 'relay.db'), { readOnly: true });
    const tg = JSON.parse(copie.prepare("SELECT valeur FROM reglages WHERE cle = 'telegram'").get().valeur);
    assert.ok(copie.prepare("SELECT 1 FROM routes WHERE hote = 'coffre.exemple.fr'").get(), 'les routes reviennent');
    copie.close();
    assert.ok(tg.jeton && !JSON.stringify(tg).includes('jeton-telegram-de-test'), 'restaurée, secrets toujours scellés');
    assert.equal((fs.statSync(path.join(dossier, 'relay.db')).mode & 0o777), 0o600);
    await assert.rejects(cli(['restaurer', pem, path.join(dossier, 'relay.db')], ''), e => /existe déjà/.test(String(e.stderr)), 'jamais par-dessus une base');
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
  assert.match((await cli(['secrets', 'retirer', 'telegram'])).toString(), /retirés : telegram\.jeton/);
  assert.equal(relay.magasin.secret('telegram', 'jeton'), '');
  const sortie = (await cli(['secrets', 'retirer'])).toString();
  assert.match(sortie, /retirés : cloudflare\.jeton/);
  assert.match(sortie, /configuration rendue sans le jeton Cloudflare/);
  assert.ok(!JSON.stringify(caddy.conf).includes('cf-jeton-de-test'), 'Caddy ne le garde pas en mémoire');
  await assert.rejects(cli(['secrets', 'retirer', 'inconnu']), e => /canal inconnu/.test(String(e.stderr)));
  const actions = relay.db.prepare("SELECT action FROM socle_journal WHERE action IN ('sauvegarde.faite', 'secrets.retires')").all().map(x => x.action);
  assert.deepEqual(actions.sort(), ['sauvegarde.faite', 'secrets.retires', 'secrets.retires']);
  assert.ok(relay.socle.journal.verifier().ok, 'la chaîne tient avec deux écrivains');
  await admin.del(`/api/routes/${r.json.route.id}`);
});

test('clé maîtresse tournée : les jetons de Relay sont rescellés sous la neuve ; sans l’ancienne, le démarrage s’arrête au lieu de les perdre', async () => {
  const { ouvrirBase, Magasin } = await import('../src/base.js');
  const { Coffre } = await import('../socle/src/index.js');
  const crypto = await import('node:crypto');
  const d = fs.mkdtempSync(path.join(tmp, 'rotation-'));
  const [c1, c2, c3] = [1, 2, 3].map(() => crypto.randomBytes(32).toString('base64'));
  const db = ouvrirBase(path.join(d, 'base'));
  try {
    new Magasin(db, { coffre: new Coffre({ cle: c1 }) }).poserSecret('telegram', 'jeton', '123456:jeton-avant-rotation-abcdefgh');
    assert.throws(() => new Magasin(db, { coffre: new Coffre({ cle: c2 }) }).resceller(), /SOCLE_CLE_ANCIENNE/);
    const m = new Magasin(db, { coffre: new Coffre({ cle: c2, ancienne: c1 }) });
    assert.deepEqual(m.resceller(), { rescelles: 1, retires: 0 });
    assert.equal(new Magasin(db, { coffre: new Coffre({ cle: c2 }) }).secret('telegram', 'jeton'), '123456:jeton-avant-rotation-abcdefgh', 'sous la seule clé neuve');
    assert.deepEqual(new Magasin(db, { coffre: new Coffre({ cle: c2 }) }).resceller(), { rescelles: 0, retires: 0 }, 'rien à refaire');
    // Illisible sous les deux clés : retiré, le bilan le dit.
    const m3 = new Magasin(db, { coffre: new Coffre({ cle: c3, ancienne: c1 }) });
    assert.deepEqual(m3.resceller(), { rescelles: 0, retires: 1 });
    assert.equal(m3.reglage('telegram').jeton, null);
  } finally { db.close(); }
});

test('noms locaux non écrits : signalé une fois, pas à chaque tour, et la fin aussi', async () => {
  const alertes = [], alerter = relay.relais.alerter, dns = relay.relais.dns;
  relay.relais.alerter = (type, texte) => alertes.push([type, texte]);
  fs.writeFileSync(path.join(tmp, 'pas-un-dossier'), '');
  relay.relais.dns = { dossier: path.join(tmp, 'pas-un-dossier'), ip: '192.0.2.10' };
  try {
    for (let i = 0; i < 3; i++) await relay.relais.reconcilier();
    assert.equal(alertes.filter(([, t]) => /Noms locaux non écrits/.test(t)).length, 1, JSON.stringify(alertes));
    relay.relais.dns = dns;
    await relay.relais.reconcilier();
    await relay.relais.reconcilier();
    assert.equal(alertes.filter(([, t]) => /de nouveau écrits/.test(t)).length, 1, JSON.stringify(alertes));
  } finally { relay.relais.alerter = alerter; relay.relais.dns = dns; }
});
