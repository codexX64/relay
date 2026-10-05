// Le cœur de Relay : créer, changer, retirer une route, et l'appliquer. Une
// écriture que Caddy refuse est défaite, en base comme chez lui ; un refus de
// Cloudflare n'empêche pas la route d'exister, il revient comme avertissement.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
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
  // dns : { dossier, ip } — le dossier que lit le résolveur de Relay, et l'adresse de la machine.
  constructor({ magasin, caddy, cloudflare, socket, journal, dns = null, alerter = () => {}, maintenant = () => Date.now() }) {
    Object.assign(this, { magasin, caddy, cloudflare, socket, journal, dns, alerter, maintenant });
    this.sante = new Map();
  }

  configuration() {
    const cf = this.cloudflare.connecte() ? { zones: this.cloudflare.zones(), jeton: this.cloudflare.jeton() } : null;
    return construire(this.magasin.routes(), { socket: this.socket, acme: this.magasin.reglage('general').acme, cloudflare: cf });
  }
  /**
   * Chaque nom que Relay sert, et chaque domaine de base, mène à cette machine
   * pour son résolveur, quel que soit le domaine. Une route du tunnel Cloudflare
   * reste au DNS public : en local, son nom n'a pas de certificat ici.
   * Écrit seulement quand la liste change ; le résolveur relit le dossier seul.
   */
  ecrireDns() {
    if (!this.dns?.dossier || !this.dns.ip) return false;
    const noms = new Set(this.magasin.reglage('general').domaines || []);
    for (const r of this.magasin.routes()) if (r.actif && !r.cf) noms.add(r.hote);
    const texte = '# Écrit par Relay : chaque nom servi ici mène à cette machine.\n'
      + [...noms].sort().map(n => `${this.dns.ip} ${n}`).join('\n') + '\n';
    const fichier = path.join(this.dns.dossier, 'relay.hosts');
    try { if (fs.readFileSync(fichier, 'utf8') === texte) return false; } catch { /* pas encore écrit */ }
    // Un nom en point : le résolveur ignore ce fichier le temps de l'écriture.
    const neuf = path.join(this.dns.dossier, '.relay.hosts.neuf');
    fs.writeFileSync(neuf, texte);
    // Lisible par le résolveur (un autre utilisateur) : le masque du processus
    // (077, posé par le socle) ne doit pas s'appliquer à ce fichier public.
    fs.chmodSync(neuf, 0o644);
    fs.renameSync(neuf, fichier);
    return true;
  }

  async appliquer() {
    try { this.ecrireDns(); } catch (e) { this.alerter('caddy', `Noms locaux non écrits : ${e.message.slice(0, 200)}`); }
    try { await this.caddy.charger(this.configuration()); }
    catch (e) { this.alerter('caddy', `Caddy a refusé la configuration : ${e.message.slice(0, 300)}`); throw e; }
  }

  /** Caddy a redémarré sans sa configuration (ou un autre l'a changée) : on la lui rend. */
  async reconcilier() {
    try { this.ecrireDns(); } catch { /* signalé par appliquer() */ }
    const attendu = this.configuration().apps.http.servers;
    const servi = await this.caddy.serveurs();
    if (canonique(servi || {}) !== canonique(attendu)) { await this.appliquer(); return true; }
    // Caddy sert déjà exactement nos routes (repris après un redémarrage) : il est à jour.
    if (!this.caddy.dernier.ok) this.caddy.dernier = { at: this.maintenant(), ok: true, erreur: null };
    return false;
  }

  async creer(entree, { proprietaire = null, client = null } = {}) {
    const r = normaliser({ actif: true, mode: 'local', ...entree });
    if (this.magasin.routeParHote(r.hote)) throw erreur(409, `${r.hote} a déjà une route.`);
    const route = this.magasin.creerRoute({ ...r, proprietaire, client });
    try { await this.appliquer(); } catch (e) { this.magasin.retirerRoute(route.id); throw e; }
    this.sonder(route).catch(() => {});
    const avertissement = await this.suivreCf(null, route);
    return { route, ...(avertissement ? { avertissement } : {}) };
  }

  async modifier(id, champs) {
    const avant = this.magasin.route(id);
    if (!avant) throw erreur(404, 'Route inconnue.');
    const r = normaliser(champs, avant);
    if (r.hote !== avant.hote && this.magasin.routeParHote(r.hote)) throw erreur(409, `${r.hote} a déjà une route.`);
    const route = this.magasin.modifierRoute(id, r);
    try { await this.appliquer(); } catch (e) { this.magasin.remettre(avant); throw e; }
    this.sonder(route).catch(() => {});
    return { route, avertissement: await this.suivreCf(avant, route) };
  }

  async retirer(id) {
    const avant = this.magasin.route(id);
    if (!avant) throw erreur(404, 'Route inconnue.');
    this.magasin.retirerRoute(id);
    this.sante.delete(id);
    try { await this.appliquer(); } catch (e) { this.magasin.remettre(avant); throw e; }
    return { ok: true, avertissement: await this.suivreCf(avant, null) };
  }

  /**
   * Cloudflare suit la route : son nom dans le tunnel (route cochée), ou son
   * enregistrement A vers la machine (route locale d'une zone du compte).
   * Jamais bloquant : un refus de Cloudflare revient comme avertissement.
   */
  async suivreCf(avant, apres) {
    const erreurs = [];
    const essai = async f => { try { await f(); } catch (e) { erreurs.push(e.message); } };
    if (this.cloudflare.actif()) {
      if (avant?.cf && (!apres?.cf || avant.hote !== apres.hote)) await essai(() => this.cloudflare.retirer(avant.hote));
      if (apres?.cf) await essai(() => this.cloudflare.publier(apres.hote));
    }
    const ip = this.dns?.ip;
    if (this.cloudflare.connecte() && ip) {
      const local = r => !!r && r.actif && !r.cf && r.mode !== 'public' && !!this.cloudflare.zoneDe(r.hote);
      if (local(avant) && (!local(apres) || avant.hote !== apres.hote)) await essai(() => this.cloudflare.retirerLocal(avant.hote));
      if (local(apres)) await essai(() => this.cloudflare.poserLocal(apres.hote, ip));
    }
    return erreurs.length ? erreurs.join(' ') : null;
  }

  /** Chaque route locale d'une zone du compte reçoit (ou perd) son enregistrement : après connexion ou déconnexion. */
  async synchroniserDomaines({ retirer = false } = {}) {
    const faits = [], erreurs = [];
    for (const r of this.magasin.routes()) {
      if (!r.actif || r.cf || r.mode === 'public' || !this.cloudflare.zoneDe(r.hote)) continue;
      try {
        if (retirer) await this.cloudflare.retirerLocal(r.hote);
        else if (this.dns?.ip) await this.cloudflare.poserLocal(r.hote, this.dns.ip);
        else continue;
        faits.push(r.hote);
      } catch (e) { erreurs.push({ hote: r.hote, erreur: e.message }); }
    }
    return { faits, erreurs };
  }

  // ---- santé : une requête HTTP vers la cible, à chaque tour ----
  // Un port ouvert ne dit pas qu'un service marche : la cible doit répondre
  // en HTTP, sans erreur serveur (5xx). Le nom demandé est celui de la route.
  sonde(route) {
    return new Promise(resolve => {
      const c = lireCible(route.cible);
      const t0 = this.maintenant();
      const mod = c.schema === 'https' ? https : http;
      let fini = false;
      const fin = (ok, detail) => { if (fini) return; fini = true; resolve({ ok, ms: this.maintenant() - t0, at: this.maintenant(), ...detail }); };
      const req = mod.request({
        host: c.hote, port: c.port, method: 'GET', path: '/', timeout: 2500,
        headers: { Host: route.enteteHote || route.hote, 'User-Agent': 'Relay-sonde' },
        ...(c.schema === 'https' ? { rejectUnauthorized: !!route.verifier, servername: net.isIP(c.hote) ? undefined : c.hote } : {}),
      }, res => { res.resume(); res.destroy(); fin(res.statusCode < 500, { code: res.statusCode }); });
      req.on('timeout', () => { req.destroy(); fin(false, { erreur: 'délai dépassé' }); });
      req.on('error', e => fin(false, { erreur: e.code === 'ECONNREFUSED' ? 'connexion refusée' : e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN' ? 'nom inconnu' : String(e.code || e.message).slice(0, 60) }));
      req.end();
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
      // Les domaines servis par Cloudflare : enregistrement public et certificat Let's Encrypt.
      zonesCloudflare: this.cloudflare.zones(),
    };
  }
}
