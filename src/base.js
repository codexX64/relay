// Base de Relay : routes (un nom → une cible), services raccordés (un jeton
// chacun, gardé par son empreinte) et réglages. Les secrets des réglages
// (jetons Cloudflare et Telegram) sont scellés par le Coffre du socle : la
// base seule ne les rend pas.
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const REF = /^[A-Za-z0-9_-]{12}$/;
export const nouvelleRef = () => crypto.randomBytes(9).toString('base64url');
export const empreinte = t => crypto.createHash('sha256').update(String(t)).digest('hex');

// Un nom servi par Caddy : des étiquettes DNS, au moins deux.
export const HOTE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;
// Une cible : hôte[:port], éventuellement en https://. Ni chemin ni identifiants.
export const CIBLE = /^(https?:\/\/)?[A-Za-z0-9._-]{1,253}(:\d{1,5})?$/;
export const MODES = ['public', 'local', 'clair'];
export const MAX_ROUTES = 500;
export const MAX_CLIENTS = 100;

export function ouvrirBase(dossier) {
  fs.mkdirSync(dossier, { recursive: true, mode: 0o700 });
  const fichier = path.join(dossier, 'relay.db');
  fs.closeSync(fs.openSync(fichier, 'a', 0o600));
  for (const f of [fichier, fichier + '-wal', fichier + '-shm']) if (fs.existsSync(f)) fs.chmodSync(f, 0o600);
  const db = new DatabaseSync(fichier);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients(
      id TEXT PRIMARY KEY, nom TEXT NOT NULL UNIQUE, portee TEXT NOT NULL,
      jeton TEXT NOT NULL UNIQUE, indice TEXT NOT NULL, cree INTEGER NOT NULL, vu INTEGER, tourne INTEGER);
    CREATE TABLE IF NOT EXISTS routes(
      id TEXT PRIMARY KEY, nom TEXT NOT NULL DEFAULT '', hote TEXT NOT NULL UNIQUE, cible TEXT NOT NULL,
      mode TEXT NOT NULL, cf INTEGER NOT NULL DEFAULT 0, verifier INTEGER NOT NULL DEFAULT 0,
      entete_hote TEXT NOT NULL DEFAULT '', actif INTEGER NOT NULL DEFAULT 1,
      -- Qui l'a posée : un service raccordé (client), le Hub (« hub:<service> »), ou personne (à la main).
      proprietaire TEXT, client TEXT REFERENCES clients(id) ON DELETE CASCADE,
      cree INTEGER NOT NULL, maj INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS reglages(cle TEXT PRIMARY KEY, valeur TEXT NOT NULL);
  `);
  return db;
}

const DEFAUTS = {
  general: { domaines: [], acme: '', sondeSecondes: 15 },
  telegram: { jeton: null, chat: '', alertes: true, commandes: false },
  cloudflare: { jeton: null, compte: '', nomCompte: '', tunnel: '', nomTunnel: '', actif: false },
};
// Les champs scellés : jamais rendus, jamais journalisés.
const SCELLES = { telegram: ['jeton'], cloudflare: ['jeton'] };

export class Magasin {
  constructor(db, { coffre }) { this.db = db; this.coffre = coffre; }

  // ---- réglages ----
  reglage(nom) {
    const l = this.db.prepare('SELECT valeur FROM reglages WHERE cle = ?').get(nom);
    let v = {};
    try { v = l ? JSON.parse(l.valeur) : {}; } catch { v = {}; }
    return { ...DEFAUTS[nom], ...v };
  }
  poserReglage(nom, valeur) {
    const fusion = { ...this.reglage(nom), ...valeur };
    this.db.prepare('INSERT INTO reglages(cle, valeur) VALUES(?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur').run(nom, JSON.stringify(fusion));
    return fusion;
  }
  secret(nom, champ) {
    const s = this.reglage(nom)[champ];
    return s ? this.coffre.ouvre(`${nom}.${champ}`, s) : '';
  }
  poserSecret(nom, champ, clair) {
    this.poserReglage(nom, { [champ]: clair ? this.coffre.scelle(`${nom}.${champ}`, clair) : null });
  }
  /** Les réglages tels qu'une interface peut les lire : un secret dit seulement s'il est posé. */
  reglagePublic(nom) {
    const r = this.reglage(nom);
    for (const champ of SCELLES[nom] || []) r[champ] = !!r[champ];
    return r;
  }

  // ---- routes ----
  ligne(r) {
    return r && { id: r.id, nom: r.nom, hote: r.hote, cible: r.cible, mode: r.mode, cf: !!r.cf, verifier: !!r.verifier, enteteHote: r.entete_hote, actif: !!r.actif, proprietaire: r.proprietaire, client: r.client, cree: r.cree, maj: r.maj };
  }
  routes() { return this.db.prepare('SELECT * FROM routes ORDER BY hote').all().map(r => this.ligne(r)); }
  route(id) { return this.ligne(this.db.prepare('SELECT * FROM routes WHERE id = ?').get(id)); }
  routeParHote(hote) { return this.ligne(this.db.prepare('SELECT * FROM routes WHERE hote = ?').get(String(hote || '').toLowerCase())); }
  creerRoute(r) {
    if (this.db.prepare('SELECT COUNT(*) n FROM routes').get().n >= MAX_ROUTES) throw Object.assign(new Error(`Au plus ${MAX_ROUTES} routes.`), { status: 409 });
    const id = nouvelleRef(), t = Date.now();
    this.db.prepare(`INSERT INTO routes(id, nom, hote, cible, mode, cf, verifier, entete_hote, actif, proprietaire, client, cree, maj)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, r.nom || '', r.hote, r.cible, r.mode, r.cf ? 1 : 0, r.verifier ? 1 : 0, r.enteteHote || '', r.actif === false ? 0 : 1, r.proprietaire || null, r.client || null, t, t);
    return this.route(id);
  }
  modifierRoute(id, champs) {
    const avant = this.route(id);
    const n = { ...avant, ...champs };
    this.db.prepare('UPDATE routes SET nom=?, hote=?, cible=?, mode=?, cf=?, verifier=?, entete_hote=?, actif=?, maj=? WHERE id=?')
      .run(n.nom || '', n.hote, n.cible, n.mode, n.cf ? 1 : 0, n.verifier ? 1 : 0, n.enteteHote || '', n.actif ? 1 : 0, Date.now(), id);
    return this.route(id);
  }
  retirerRoute(id) { this.db.prepare('DELETE FROM routes WHERE id = ?').run(id); }
  /** Remet une route telle qu'elle était (une écriture que Caddy a refusée). */
  remettre(r) {
    this.db.prepare(`INSERT OR REPLACE INTO routes(id, nom, hote, cible, mode, cf, verifier, entete_hote, actif, proprietaire, client, cree, maj)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(r.id, r.nom, r.hote, r.cible, r.mode, r.cf ? 1 : 0, r.verifier ? 1 : 0, r.enteteHote || '', r.actif ? 1 : 0, r.proprietaire, r.client, r.cree, r.maj);
  }

  // ---- services raccordés ----
  clientPublic(c) { return c && { id: c.id, nom: c.nom, portee: c.portee, indice: c.indice, cree: c.cree, vu: c.vu, tourne: c.tourne, routes: this.db.prepare('SELECT hote FROM routes WHERE client = ? ORDER BY hote').all(c.id).map(l => l.hote) }; }
  clients() { return this.db.prepare('SELECT * FROM clients ORDER BY nom').all().map(c => this.clientPublic(c)); }
  client(idOuNom) { return this.db.prepare('SELECT * FROM clients WHERE id = ? OR nom = ?').get(idOuNom, idOuNom) || null; }
  clientParJeton(jeton) { return this.db.prepare('SELECT * FROM clients WHERE jeton = ?').get(empreinte(jeton)) || null; }
  creerClient(nom, portee) {
    if (this.db.prepare('SELECT COUNT(*) n FROM clients').get().n >= MAX_CLIENTS) throw Object.assign(new Error(`Au plus ${MAX_CLIENTS} services raccordés.`), { status: 409 });
    const jeton = 'svc_' + crypto.randomBytes(24).toString('base64url');
    const id = nouvelleRef();
    this.db.prepare('INSERT INTO clients(id, nom, portee, jeton, indice, cree) VALUES(?,?,?,?,?,?)').run(id, nom, portee, empreinte(jeton), '…' + jeton.slice(-4), Date.now());
    return { client: this.clientPublic(this.client(id)), jeton };
  }
  tournerClient(id) {
    const jeton = 'svc_' + crypto.randomBytes(24).toString('base64url');
    this.db.prepare('UPDATE clients SET jeton = ?, indice = ?, tourne = ? WHERE id = ?').run(empreinte(jeton), '…' + jeton.slice(-4), Date.now(), id);
    return { client: this.clientPublic(this.client(id)), jeton };
  }
  vu(id) { this.db.prepare('UPDATE clients SET vu = ? WHERE id = ?').run(Date.now(), id); }
  retirerClient(id) { this.db.prepare('DELETE FROM clients WHERE id = ?').run(id); }
}
