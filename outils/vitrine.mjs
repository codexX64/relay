// Un Relay de démonstration : un faux Caddy sur un socket Unix (il garde ce
// qu'on lui pousse), des routes de chaque sorte, et la porte du socle à ouvrir.
//   node outils/vitrine.mjs 8196
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { demarrer } from '../src/main.js';

const port = Number(process.argv[2] || 8196);
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-vitrine-'));
const socket = path.join(dossier, 'admin.sock');
let conf = null;
await new Promise(r => http.createServer((req, res) => {
  let corps = ''; req.on('data', d => { corps += d; });
  req.on('end', () => {
    if (req.url === '/load') { conf = JSON.parse(corps); res.end('{}'); return; }
    if (req.url === '/config/apps/http/servers') { res.writeHead(conf ? 200 : 400); res.end(JSON.stringify(conf ? conf.apps.http.servers : { error: 'vide' })); return; }
    if (req.url === '/pki/ca/local') { res.end(JSON.stringify({ root_certificate: '-----BEGIN CERTIFICATE-----\nVITRINE\n-----END CERTIFICATE-----\n' })); return; }
    res.writeHead(404); res.end();
  });
}).listen(socket, r));
const jeton = 'jeton-installation-de-la-vitrine-relay';
const relay = await demarrer({ DATA_DIR: path.join(dossier, 'data'), PORT: String(port), HOTE: '127.0.0.1', RELAY_CADDY_SOCKET: socket, SOCLE_JETON_INSTALLATION: jeton, RELAY_HUB_TOKEN: 'jeton-du-hub-de-la-vitrine-0123456789' }, { log: { info() {}, warn() {}, error() {} } });
relay.magasin.poserReglage('general', { domaines: ['home.arpa', 'exemple.org'] });
for (const r of [
  { hote: 'mapmylan.home.arpa', cible: 'hub-mapmylan:8090', mode: 'local', nom: 'MapMyLAN' },
  { hote: 'hyperviseur-de-la-salle-serveur.home.arpa', cible: 'https://192.0.2.30:8006', mode: 'local', nom: 'Hyperviseur' },
  { hote: 'statut.exemple.org', cible: 'hub-oracle:8090', mode: 'clair', cf: true, actif: false },
]) await relay.relais.creer(r, { proprietaire: r.hote.startsWith('mapmylan') ? 'hub:mapmylan' : null });
relay.magasin.creerClient('gestionnaire-de-conteneurs', 'routes');
console.log(`Relay de démonstration sur http://localhost:${port} — jeton d’installation : ${jeton}`);
