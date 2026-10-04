// Caddy, piloté par son API d'administration sur un socket Unix. Chaque
// écriture reconstruit la configuration entière et la pousse sur /load : si
// Caddy la refuse, rien ne change chez lui et l'erreur remonte telle quelle.
import http from 'node:http';

// Une cible : schéma, hôte et port (80 en http, 443 en https par défaut).
export function lireCible(brut) {
  let s = String(brut || '').trim(), schema = 'http';
  if (/^https:\/\//i.test(s)) { schema = 'https'; s = s.slice(8); } else if (/^http:\/\//i.test(s)) s = s.slice(7);
  const i = s.lastIndexOf(':');
  const hote = i > 0 ? s.slice(0, i) : s;
  const port = i > 0 ? Number(s.slice(i + 1)) : (schema === 'https' ? 443 : 80);
  return { schema, hote, port, dial: `${hote}:${port}` };
}

function proxy(r) {
  const c = lireCible(r.cible);
  const h = { handler: 'reverse_proxy', upstreams: [{ dial: c.dial }] };
  // Une machine qui parle TLS (souvent auto-signée) : certificat vérifié seulement si
  // la route le demande, la plupart portant un certificat auto-signé.
  if (c.schema === 'https') h.transport = { protocol: 'http', tls: r.verifier ? {} : { insecure_skip_verify: true } };
  const poser = {};
  if (r.enteteHote) poser.Host = [r.enteteHote];
  // Derrière le tunnel, Cloudflare porte le TLS et transmet en clair : sans
  // cela le service se croit en HTTP et fabrique des liens que le navigateur bloque.
  if (r.cf) { poser['X-Forwarded-Proto'] = ['https']; poser['X-Forwarded-Ssl'] = ['on']; }
  if (Object.keys(poser).length) h.headers = { request: { set: poser } };
  return h;
}
const routeProxy = r => ({ match: [{ host: [r.hote] }], handle: [proxy(r)], terminal: true });
const routeVersHttps = r => ({
  match: [{ host: [r.hote] }],
  handle: [{ handler: 'static_response', status_code: 308, headers: { Location: ['https://{http.request.host}{http.request.uri}'] } }],
  terminal: true,
});

/**
 * La configuration complète de Caddy. Mode public : certificat Let's Encrypt ;
 * local : signé par l'autorité interne de Caddy ; clair : HTTP seul sur le
 * port 80 (derrière le tunnel Cloudflare, ou un autre relais).
 */
export function construire(routes, { socket, acme = '', cloudflare = null }) {
  const vivantes = routes.filter(r => r.actif && r.hote && r.cible);
  const tls = vivantes.filter(r => r.mode !== 'clair');
  const clair = vivantes.filter(r => r.mode === 'clair');
  const serveurs = {};
  const surLe80 = [...clair.map(routeProxy), ...tls.map(routeVersHttps)];
  if (surLe80.length) serveurs.web = { listen: [':80'], routes: surLe80, automatic_https: { disable_redirects: true } };
  if (tls.length) serveurs.websecure = { listen: [':443'], routes: tls.map(routeProxy), automatic_https: { disable_redirects: true } };
  // Le socket vit dans un volume que seuls Caddy et Relay montent : 0666 ne
  // l'ouvre à personne d'autre, et Relay ne tourne pas sous l'utilisateur de Caddy.
  // persist false : la configuration (et le jeton Cloudflare qu'elle peut
  // porter) n'est jamais écrite sur le disque de Caddy ; Relay la lui rend à
  // chaque redémarrage (reconcilier).
  const conf = { admin: { listen: `unix/${socket}|0666`, config: { persist: false } }, apps: { http: { servers: serveurs } } };
  const politiques = [];
  const dansZone = h => !!cloudflare?.jeton && (cloudflare.zones || []).some(z => h === z || h.endsWith(`.${z}`));
  const locaux = tls.filter(r => r.mode === 'local').map(r => r.hote);
  const parDns = locaux.filter(dansZone), internes = locaux.filter(h => !dansZone(h));
  const publics = tls.filter(r => r.mode === 'public').map(r => r.hote);
  // Un nom local d'une zone Cloudflare : certificat Let's Encrypt par le défi
  // DNS (aucun port à ouvrir), reconnu par tous les appareils.
  if (parDns.length) {
    politiques.push({ subjects: parDns, issuers: [{ module: 'acme', ...(acme ? { email: acme } : {}),
      challenges: { dns: { provider: { name: 'cloudflare', api_token: cloudflare.jeton }, resolvers: ['1.1.1.1:53', '1.0.0.1:53'] } } }] });
  }
  if (internes.length) politiques.push({ subjects: internes, issuers: [{ module: 'internal' }] });
  if (publics.length) politiques.push({ subjects: publics, issuers: [{ module: 'acme', ...(acme ? { email: acme } : {}) }] });
  if (politiques.length) conf.apps.tls = { automation: { policies: politiques } };
  return conf;
}

export class Caddy {
  constructor({ socket, delai = 15000 }) { this.socket = socket; this.delai = delai; this.dernier = { at: null, ok: false, erreur: 'jamais appliquée' }; }

  appel(methode, chemin, corps) {
    return new Promise((resolve, reject) => {
      const donnees = corps === undefined ? null : JSON.stringify(corps);
      const req = http.request({
        socketPath: this.socket, method: methode, path: chemin, timeout: this.delai,
        // L'API d'administration vérifie l'en-tête Host : celui de son socket.
        headers: { Host: 'caddy', ...(donnees ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(donnees) } : {}) },
      }, res => {
        const morceaux = [];
        res.on('data', m => morceaux.push(m));
        res.on('end', () => resolve({ status: res.statusCode, texte: Buffer.concat(morceaux).toString('utf8') }));
      });
      req.on('timeout', () => req.destroy(new Error('Caddy ne répond pas (délai dépassé).')));
      req.on('error', e => reject(new Error(e.code === 'ENOENT' || e.code === 'ECONNREFUSED' ? 'Caddy est injoignable : son socket d’administration est absent.' : e.message)));
      if (donnees) req.write(donnees);
      req.end();
    });
  }

  async charger(conf) {
    const r = await this.appel('POST', '/load', conf);
    if (r.status >= 300) {
      const erreur = r.texte.slice(0, 600) || `Caddy a répondu ${r.status}.`;
      this.dernier = { at: Date.now(), ok: false, erreur };
      throw Object.assign(new Error(erreur), { status: 502 });
    }
    this.dernier = { at: Date.now(), ok: true, erreur: null };
  }

  /** Les serveurs que Caddy sert en ce moment (vide s'il vient de redémarrer sans configuration). */
  async serveurs() {
    const r = await this.appel('GET', '/config/apps/http/servers');
    if (r.status >= 300) return null;
    try { return JSON.parse(r.texte || 'null'); } catch { return null; }
  }

  /** Le certificat racine de l'autorité interne : à installer sur les postes pour le mode local. */
  async racine() {
    const r = await this.appel('GET', '/pki/ca/local');
    if (r.status >= 300) throw Object.assign(new Error('L’autorité interne de Caddy n’existe pas encore : crée d’abord une route en mode local.'), { status: 404 });
    return JSON.parse(r.texte).root_certificate;
  }
}
