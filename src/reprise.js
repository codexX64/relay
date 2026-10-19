// Reprise d'un Relay 1.x : son dossier data/ (routes.json, settings.json),
// monté en lecture seule et désigné par RELAY_REPRISE. Une seule fois, sur
// une base sans route. Les routes, les services raccordés (leurs jetons
// restent valables : seule leur empreinte était gardée, elle est reprise
// telle quelle) et les réglages Telegram et Cloudflare (jetons scellés à
// l'arrivée). Le compte de la 1.x ne l'est pas : le premier administrateur
// vient du Hub, avec les facteurs du socle.
import fs from 'node:fs';
import path from 'node:path';
import { nouvelleRef } from './base.js';
import { normaliser } from './relais.js';

const NOM_SERVICE = /^[a-z0-9][a-z0-9-]{1,39}$/;

const MODE = { auto: 'public', internal: 'local', off: 'clair' };

export function reprendre({ dossier, db, magasin, journal, log = console }) {
  if (!dossier) return null;
  if (magasin.reglage('general').repris || db.prepare('SELECT COUNT(*) n FROM routes').get().n) return null;
  const lire = f => { try { return JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8')); } catch { return null; } };
  const routes = lire('routes.json')?.routes || [];
  const reglages = lire('settings.json') || {};
  const bilan = { routes: 0, clients: 0, ignorees: [] };

  db.exec('BEGIN');
  try {
    const ids = new Map();
    for (const c of Array.isArray(reglages.clients) ? reglages.clients : []) {
      if (!NOM_SERVICE.test(String(c?.name || '').toLowerCase()) || !/^[a-f0-9]{64}$/.test(c.tokenHash || '')) continue;
      const id = nouvelleRef();
      ids.set(c.id, id);
      db.prepare('INSERT INTO clients(id, nom, portee, jeton, indice, cree, vu) VALUES(?,?,?,?,?,?,?)')
        .run(id, String(c.name).toLowerCase(), c.scope === 'routes' ? 'routes' : 'soi', c.tokenHash, String(c.hint || '…').slice(0, 8), Number(c.created) || Date.now(), Number(c.lastSeen) || null);
      bilan.clients++;
    }
    for (const r of routes) {
      // Chaque route passe le contrôle d'une saisie (nom, cible, port, en-tête
      // Host). Une cible docker:// suivait un conteneur par le socket Docker,
      // que Relay 2 ne monte plus : à republier depuis le Hub.
      let n;
      try {
        n = normaliser({ nom: String(r.name || ''), hote: String(r.host || ''), cible: String(r.upstream || ''), mode: MODE[r.tls] || 'public', cf: !!r.cf, verifier: !!r.verify, enteteHote: String(r.hostHeader || ''), actif: r.enabled !== false });
      } catch { bilan.ignorees.push(String(r.host || '').toLowerCase().slice(0, 253) || '(sans nom)'); continue; }
      const t = Date.now();
      const client = r.owner ? ids.get(r.owner) || null : null;
      db.prepare(`INSERT OR IGNORE INTO routes(id, nom, hote, cible, mode, cf, verifier, entete_hote, actif, proprietaire, client, cree, maj)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(nouvelleRef(), n.nom, n.hote, n.cible, n.mode,
        n.cf ? 1 : 0, n.verifier ? 1 : 0, n.enteteHote, n.actif ? 1 : 0, client ? 'service:1.x' : null, client, Number(r.created) || t, t);
      bilan.routes++;
    }
    const g = reglages.general || {};
    magasin.poserReglage('general', {
      domaines: (Array.isArray(g.domains) ? g.domains : []).filter(d => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)).slice(0, 20),
      acme: g.acmeEmail || '', sondeSecondes: Math.max(5, Math.round((Number(g.probeMs) || 15000) / 1000)), repris: true,
    });
    const tg = reglages.telegram || {};
    if (tg.token) magasin.poserSecret('telegram', 'jeton', tg.token);
    magasin.poserReglage('telegram', { chat: String(tg.chat || ''), alertes: tg.alerts !== false, commandes: !!tg.commands });
    const cf = reglages.cloudflare || {};
    if (cf.token) magasin.poserSecret('cloudflare', 'jeton', cf.token);
    magasin.poserReglage('cloudflare', { compte: cf.accountId || '', nomCompte: cf.accountName || '', tunnel: cf.tunnelId || '', nomTunnel: cf.tunnelName || '', actif: !!cf.enabled });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  journal.ecrire({ acteur: 'système', action: 'reprise.1x', objet: 'relay', resultat: 'succes', details: bilan });
  log.info?.(`[reprise] Relay 1.x : ${bilan.routes} route(s), ${bilan.clients} service(s) raccordé(s)${bilan.ignorees.length ? `, ${bilan.ignorees.length} route(s) à republier depuis le Hub (cible docker://) : ${bilan.ignorees.join(', ')}` : ''}.`);
  return bilan;
}
