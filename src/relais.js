// Le cœur de Relay : créer, changer, retirer une route, et l'appliquer. Une
// écriture que Caddy refuse est défaite, en base comme chez lui ; un refus de
// Cloudflare n'empêche pas la route d'exister, il revient comme avertissement.
import net from 'node:net';
import { construire, lireCible } from './caddy.js';
import { HOTE, CIBLE, MODES } from './base.js';

const erreur = (status, message) => Object.assign(new Error(message), { status });
// Caddy rend sa configuration clés triées : on compare sous la même forme.
const canonique = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

/** Une route saisie, normalisée et contrôlée : nom, cible, mode. */
export function normaliser(e, base = {}) {
  const r = { ...base };
  if ('nom' in e) r.nom = String(e.nom || '').trim().slice(0, 60);
  if ('hote' in e) r.hote = String(e.hote || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/:].*$/, '');
  if ('cible' in e) r.cible = String(e.cible || '').trim().replace(/\/+$/, '');
  if ('mode' in e) r.mode = e.mode;
  for (const k of ['cf', 'verifier', 'actif']) if (k in e) r[k] = !!e[k];
  if ('enteteHote' in e) r.enteteHote = String(e.enteteHote || '').trim().toLowerCase();
  if (!r.hote || !HOTE.test(r.hote)) throw erreur(400, 'Nom invalide : un domaine complet est attendu (ex. carte.exemple.fr).');
  if (!r.cible || !CIBLE.test(r.cible)) throw erreur(400, 'Cible invalide : hôte:port, ou https://hôte:port quand la machine parle TLS.');
  const c = lireCible(r.cible);
  if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535) throw erreur(400, 'Cible invalide : port entre 1 et 65535.');
  if (!MODES.includes(r.mode)) throw erreur(400, `Mode inconnu : ${MODES.join(', ')}.`);
  if (r.enteteHote && !/^[a-z0-9.-]{1,253}(:\d{1,5})?$/.test(r.enteteHote)) throw erreur(400, 'En-tête Host invalide.');
  // Derrière le tunnel, Cloudflare porte le TLS : le mode public ferait
  // boucler la redirection 308 du port 80.
  if (r.cf) r.mode = 'clair';
  return r;
}

export class Relais {
  constructor({ magasin, caddy, cloudflare, socket, journal, alerter = () => {}, maintenant = () => Date.now() }) {
    Object.assign(this, { magasin, caddy, cloudflare, socket, journal, alerter, maintenant });
    this.sante = new Map();
  }

  configuration() { return construire(this.magasin.routes(), { socket: this.socket, acme: this.magasin.reglage('general').acme }); }
  async appliquer() {
    try { await this.caddy.charger(this.configuration()); }
    catch (e) { this.alerter('caddy', `Caddy a refusé la configuration : ${e.message.slice(0, 300)}`); throw e; }
  }

  /** Caddy a redémarré sans sa configuration (ou un autre l'a changée) : on la lui rend. */
  async reconcilier() {
    const attendu = this.configuration().apps.http.servers;
    const servi = await this.caddy.serveurs();
    if (canonique(servi || {}) !== canonique(attendu)) { await this.appliquer(); return true; }
    return false;
  }

  async creer(entree, { proprietaire = null, client = null } = {}) {
    const r = normaliser({ actif: true, mode: 'local', ...entree });
    if (this.magasin.routeParHote(r.hote)) throw erreur(409, `${r.hote} a déjà une route.`);
    const route = this.magasin.creerRoute({ ...r, proprietaire, client });
    try { await this.appliquer(); } catch (e) { this.magasin.retirerRoute(route.id); throw e; }
    this.sonder(route).catch(() => {});
    return { route, ...(await this.publierCf(route)) };
  }

  async modifier(id, champs) {
    const avant = this.magasin.route(id);
    if (!avant) throw erreur(404, 'Route inconnue.');
    const r = normaliser(champs, avant);
    if (r.hote !== avant.hote && this.magasin.routeParHote(r.hote)) throw erreur(409, `${r.hote} a déjà une route.`);
    const route = this.magasin.modifierRoute(id, r);
    try { await this.appliquer(); } catch (e) { this.magasin.remettre(avant); throw e; }
    this.sonder(route).catch(() => {});
    let avertissement = null;
    if (this.cloudflare.actif()) {
      try {
        if (avant.cf && (!route.cf || avant.hote !== route.hote)) await this.cloudflare.retirer(avant.hote);
        if (route.cf) await this.cloudflare.publier(route.hote);
      } catch (e) { avertissement = e.message; }
    }
    return { route, avertissement };
  }

  async retirer(id) {
    const avant = this.magasin.route(id);
    if (!avant) throw erreur(404, 'Route inconnue.');
    this.magasin.retirerRoute(id);
    this.sante.delete(id);
    try { await this.appliquer(); } catch (e) { this.magasin.remettre(avant); throw e; }
    let avertissement = null;
    if (avant.cf && this.cloudflare.actif()) { try { await this.cloudflare.retirer(avant.hote); } catch (e) { avertissement = e.message; } }
    return { ok: true, avertissement };
  }

  async publierCf(route) {
    if (!route.cf || !this.cloudflare.actif()) return {};
    try { return { cloudflare: await this.cloudflare.publier(route.hote) }; } catch (e) { return { avertissement: e.message }; }
  }

  // ---- santé : une connexion TCP vers la cible, à chaque tour ----
  sonde(route) {
    return new Promise(resolve => {
      const c = lireCible(route.cible);
      const t0 = this.maintenant();
      const s = net.connect({ host: c.hote, port: c.port });
      const fin = ok => { s.destroy(); resolve({ ok, ms: this.maintenant() - t0, at: this.maintenant() }); };
      s.setTimeout(2500);
      s.once('connect', () => fin(true));
      s.once('timeout', () => fin(false));
      s.once('error', () => fin(false));
    });
  }
  async sonder(route) {
    const avant = this.sante.get(route.id);
    const maintenant = await this.sonde(route);
    if (this.ferme || !this.magasin.route(route.id)) return maintenant;
    this.sante.set(route.id, maintenant);
    if (avant && avant.ok !== maintenant.ok && route.actif) {
      this.alerter(maintenant.ok ? 'reprise' : 'panne', maintenant.ok
        ? `${route.hote} répond de nouveau (${maintenant.ms} ms).`
        : `${route.hote} ne répond plus (cible ${route.cible}).`, { route: route.hote, ok: maintenant.ok });
      this.journal?.ecrire({ acteur: 'système', action: maintenant.ok ? 'route.reprise' : 'route.panne', objet: route.hote, resultat: maintenant.ok ? 'succes' : 'erreur' });
    }
    return maintenant;
  }
  async sonderTout() { await Promise.all(this.magasin.routes().map(r => this.sonder(r))); }

  etat() {
    return {
      routes: this.magasin.routes().map(r => ({ ...r, sante: this.sante.get(r.id) || null })),
      caddy: this.caddy.dernier,
      cloudflare: this.cloudflare.actif(),
    };
  }
}
