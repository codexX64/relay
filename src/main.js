// Démarrage de Relay : configuration validée, base, socle commun (comptes,
// sessions, coffre, journal), reprise d'une 1.x, Caddy remis à jour, sondes,
// bot Telegram, et serveur HTTP de l'interface et de l'API.
import http from 'node:http';
import path from 'node:path';
import { lireConfigRelay, VERSION } from './config.js';
import { ouvrirBase, Magasin } from './base.js';
import { Caddy } from './caddy.js';
import { Cloudflare } from './cloudflare.js';
import { Relais } from './relais.js';
import { Telegram } from './telegram.js';
import { reprendre } from './reprise.js';
import { creerApi } from './api.js';
import {
  Debit, ErreurHttp, demarrerSocle, entetesSecurite, envelopper, nonceCsp, politiqueContenu,
  repondreErreur, repondreJson, servirFichier,
} from '../socle/src/index.js';

const RACINE = path.resolve(import.meta.dirname, '..');
const CONSOLE = { info: (...a) => console.log(...a), warn: (...a) => console.warn(...a), error: (...a) => console.error(...a) };
const CONTACT_SECURITE = 'https://github.com/CodexX64/relay/security/advisories/new';
const ICONE = { panne: '🔴', reprise: '🟢', caddy: '⚠️' };

export async function demarrer(env = process.env, { log = CONSOLE } = {}) {
  const cfg = lireConfigRelay(env);
  const db = ouvrirBase(cfg.donnees);
  const socle = await demarrerSocle({ service: { id: 'relay', nom: 'Relay', contactSecurite: CONTACT_SECURITE }, db, dossier: cfg.donnees, env, log });
  const magasin = new Magasin(db, { coffre: socle.coffre });
  if (cfg.acme && !magasin.reglage('general').acme) magasin.poserReglage('general', { acme: cfg.acme });
  reprendre({ dossier: cfg.reprise, db, magasin, journal: socle.journal, log });

  const caddy = new Caddy({ socket: cfg.caddySocket });
  const cloudflare = new Cloudflare({ magasin, api: cfg.cfApi, service: cfg.caddyService });
  let telegram = null;
  const relais = new Relais({
    magasin, caddy, cloudflare, socket: cfg.caddySocket, journal: socle.journal,
    alerter: (type, texte) => telegram?.alerte(`${ICONE[type] || ''} <b>Relay</b> — ${texte.replace(/&/g, '&amp;').replace(/</g, '&lt;')}`),
  });
  telegram = new Telegram({ magasin, relais, api: cfg.tgApi, journal: socle.journal });
  const api = creerApi({ socle, cfg, magasin, relais, cloudflare, telegram });

  // Caddy peut démarrer après Relay, ou redémarrer seul : à chaque tour, sa
  // configuration est comparée à la nôtre et rendue si elle diffère.
  let enCours = Promise.resolve();
  const tour = () => (enCours = (async () => {
    try { await relais.reconcilier(); } catch (e) { log.warn?.(`[caddy] ${e.message}`); }
    try { await relais.sonderTout(); } catch (e) { log.warn?.(`[sondes] ${e.message}`); }
  })());
  let minuterie = null, arrete = false;
  const programmer = () => {
    clearTimeout(minuterie);
    if (arrete) return;
    minuterie = setTimeout(async () => { if (!arrete) await tour(); programmer(); }, magasin.reglage('general').sondeSecondes * 1000);
    minuterie.unref?.();
  };
  tour().finally(programmer);
  telegram.demarrer();

  const debit = new Debit({ max: 900 });
  const serveur = http.createServer(envelopper(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://relay');
      const ctx = socle.portail.contexte(req, res);
      if (!debit.prendre(ctx.ip)) throw new ErreurHttp(429, 'Trop de requêtes.');
      ctx.url = url;
      const nonce = nonceCsp();
      entetesSecurite(res, { secure: ctx.securise, hote: req.headers.host, csp: politiqueContenu({ nonce, secure: ctx.securise, img: ['data:'] }) });
      if (await socle.portail.traiter(req, res, url, ctx)) return;
      if (await api.traiter(ctx)) return;
      if (!['GET', 'HEAD'].includes(req.method)) return repondreJson(res, 405, { error: 'Méthode non admise.' });
      if (url.pathname.startsWith('/socle/') && servirFichier(req, res, path.join(RACINE, 'socle', 'web'), url.pathname.slice(6), { nonce, cache: 'public, max-age=3600' })) return;
      const fichier = url.pathname === '/' ? '/index.html' : url.pathname;
      if (servirFichier(req, res, path.join(RACINE, 'web'), fichier, { nonce, gamme: socle.cfg.gamme })) return;
      repondreJson(res, 404, { error: 'Introuvable.' });
    } catch (e) { repondreErreur(res, e, { journal: log }); }
  }));
  serveur.headersTimeout = 20_000;
  serveur.requestTimeout = 60_000;
  serveur.keepAliveTimeout = 5_000;
  await new Promise(r => serveur.listen(cfg.port, cfg.hote, r));
  log.info?.(`Relay ${VERSION} à l’écoute sur ${cfg.hote}:${serveur.address().port}`);

  return {
    serveur, db, socle, magasin, relais, telegram, api, port: serveur.address().port,
    async arreter() {
      arrete = true; relais.ferme = true; clearTimeout(minuterie); telegram.arreter(); socle.arreter();
      await new Promise(r => serveur.close(r));
      await enCours;
      db.close();
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.umask(0o077);
  const r = await demarrer().catch(e => { console.error(e.message); process.exit(1); });
  const fin = async sig => { console.log(`${sig} reçu, arrêt propre`); await r.arreter(); process.exit(0); };
  process.on('SIGINT', fin);
  process.on('SIGTERM', fin);
}
