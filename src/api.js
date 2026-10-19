// Routes de Relay. Trois sortes d'appelants, chacun borné :
//   - une session du socle (l'interface de Relay) : lecture pour voir, admin
//     pour changer ce qui est exposé ; les jetons et les secrets sous renfort ;
//   - le Hub, par son jeton : toutes les routes, et la publication des
//     services qu'il installe — jamais les jetons de services ni les réglages ;
//   - un service raccordé, par le sien : ses propres routes (« soi »), ou
//     toutes les routes (« routes ») pour un gestionnaire de conteneurs.
import { ErreurHttp, Routeur, lireCorps, valider, egal, repondreJson } from '../socle/src/index.js';
import { REF, HOTE, MODES } from './base.js';

const T = (max, o = {}) => ({ type: 'chaine', max, ...o });
const B = { type: 'booleen' };
const NOM_SERVICE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const DOMAINE = /^(?=.{1,253}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/;

const S = {
  route: { nom: T(60), hote: T(253, { requis: true }), cible: T(300, { requis: true }), mode: T(10, { parmi: MODES }), cf: B, verifier: B, enteteHote: T(260), actif: B },
  routeModif: { nom: T(60), hote: T(253), cible: T(300), mode: T(10, { parmi: MODES }), cf: B, verifier: B, enteteHote: T(260), actif: B },
  client: { nom: T(40, { requis: true, motif: NOM_SERVICE }), portee: T(10, { parmi: ['soi', 'routes'], defaut: 'soi' }) },
  // Contrat de l'API de publication (INTEGRATION.md) : noms de champs anglais, inchangés depuis la 1.x.
  register: { subdomain: T(63, { motif: /^[a-z0-9-]{1,63}$/ }), host: T(253), upstream: T(300, { requis: true }), mode: T(12, { parmi: ['cloudflare', 'public', 'local'] }), name: T(60) },
  publication: { service: T(40, { requis: true, motif: NOM_SERVICE }), hote: T(253), sousDomaine: T(63, { motif: /^[a-z0-9-]{1,63}$/ }), cible: T(300, { requis: true }), mode: T(10, { parmi: [...MODES, 'cloudflare'] }), nom: T(60) },
  general: { domaines: { type: 'liste', max: 20, de: T(253, { motif: DOMAINE }) }, acme: T(254, { motif: /^([^\s@]+@[^\s@]+\.[^\s@]+)?$/ }), sondeSecondes: { type: 'entier', min: 5, max: 3600 } },
  telegram: { jeton: T(100, { motif: /^\d{5,15}:[A-Za-z0-9_-]{20,60}$/ }), retirerJeton: B, alertes: B, commandes: B, retirerChat: B },
  cloudflareHub: { jeton: T(200, { requis: true, motif: /^[A-Za-z0-9_-]{20,200}$/ }) },
  tunnelHub: { tunnel: T(36, { motif: /^[0-9a-f-]{36}$/ }), nom: T(60, { motif: /^[A-Za-z0-9][\w.-]{0,59}$/ }) },
  cloudflare: { jeton: T(200, { motif: /^[A-Za-z0-9_-]{20,200}$/ }), retirerJeton: B, compte: T(64, { motif: /^[a-f0-9]{0,64}$/ }), nomCompte: T(120), tunnel: T(64, { motif: /^([0-9a-f-]{36})?$/ }), nomTunnel: T(120), actif: B },
  essaiCf: { jeton: T(200, { motif: /^[A-Za-z0-9_-]{20,200}$/ }) },
  apercu: { hote: T(253, { requis: true, motif: HOTE }) },
  essaiTg: {},
};

// Un refus de Caddy, Cloudflare ou Telegram : 502, avec leur message (voir traiter).
const refusExterne = message => Object.assign(new Error(message), { status: 502 });

const MODE_REGISTER = { cloudflare: 'clair', public: 'public', local: 'local' };
const TLS_1X = { public: 'auto', local: 'internal', clair: 'off' };
// La forme d'une route dans le contrat de publication de la 1.x.
const route1x = r => ({ id: r.id, host: r.hote, upstream: r.cible, tls: TLS_1X[r.mode], cf: r.cf });

export function creerApi({ socle, cfg, magasin, relais, cloudflare, telegram }) {
  const r = new Routeur();
  const { portail, journal, limiteur } = socle;

  // ---- qui appelle ----
  const presente = ctx => {
    const k = ctx.req.headers['x-relay-key'];
    if (typeof k === 'string' && k) return k;
    const a = String(ctx.req.headers.authorization || '');
    return a.startsWith('Bearer ') ? a.slice(7) : '';
  };
  const cleMachine = ctx => [`ip:machine:${ctx.ip}`];
  // Un jeton présenté est vérifié ; un faux compte comme un échec et ne
  // retombe jamais sur la session.
  const appelant = ctx => {
    if (ctx.appelant !== undefined) return ctx.appelant;
    const j = presente(ctx);
    if (!j) return (ctx.appelant = null);
    limiteur.controler(cleMachine(ctx));
    if (cfg.jetonHub && egal(j, cfg.jetonHub)) return (ctx.appelant = { type: 'hub', nom: 'hub' });
    const c = magasin.clientParJeton(j);
    if (c) { magasin.vu(c.id); return (ctx.appelant = { type: 'client', client: c, nom: c.nom }); }
    limiteur.echec(cleMachine(ctx));
    journal.rare(`jeton:${ctx.ip}`, { action: 'connexion.jeton', objet: ctx.url.pathname, ip: ctx.ip, resultat: 'refus' });
    throw new ErreurHttp(401, 'Jeton invalide.');
  };
  const session = (ctx, opts = {}) => portail.exiger(ctx, { role: 'lecture', ...opts });
  // Toutes les routes : le Hub, un service de portée « routes », ou une session.
  const surLesRoutes = (ctx, role) => {
    const a = appelant(ctx);
    if (a?.type === 'hub' || (a?.type === 'client' && a.client.portee === 'routes')) return a;
    if (a) throw new ErreurHttp(403, 'Ce jeton ne publie que ses propres routes : /api/register, /api/heartbeat, /api/whoami.');
    const s = session(ctx, { role });
    return { type: 'session', nom: s.compteLigne.identifiant, compte: s.compte };
  };
  const service = ctx => {
    const a = appelant(ctx);
    if (a?.type !== 'client') throw new ErreurHttp(403, 'Un jeton de service est exigé ici.');
    return a.client;
  };
  const hub = ctx => {
    if (appelant(ctx)?.type !== 'hub') throw new ErreurHttp(403, 'Réservé au Hub.');
  };
  const tracer = (ctx, qui, action, objet, details) => journal.ecrire({ acteur: qui.compte || qui.nom, action, objet, ip: ctx.ip, details });

  const corps = async (ctx, schema) => valider(await lireCorps(ctx.req, { limite: 32 * 1024 }), schema);
  const route = id => magasin.route(id) || (() => { throw new ErreurHttp(404, 'Route inconnue.'); })();
  const domaineDeBase = () => magasin.reglage('general').domaines[0] || '';

  // Un jeton vérifié (les zones qu'il voit), scellé, puis Caddy et les
  // enregistrements suivent. Le retirer rend les noms au certificat de Relay
  // après avoir effacé les enregistrements qu'il avait écrits.
  const connecterCf = async jeton => {
    let zones;
    // Un jeton refusé est une saisie à corriger (400) ; Cloudflare muet, une panne en amont (502).
    try { zones = await cloudflare.zonesDuJeton(jeton); } catch (e) { throw Object.assign(new Error(e.message), { status: /injoignable/.test(e.message) ? 502 : 400 }); }
    magasin.poserSecret('cloudflare', 'jeton', jeton);
    magasin.poserReglage('cloudflare', { zones });
    // Le jeton est bon et enregistré : un Caddy arrêté ne l'annule pas, il
    // recevra sa configuration au prochain tour. On le dit, sans erreur 500.
    let avertissement = null;
    try { await relais.appliquer(); } catch (e) { avertissement = `Cloudflare est connecté, mais ${e.message.charAt(0).toLowerCase()}${e.message.slice(1)} Les certificats viendront quand Caddy répondra.`; }
    return { zones, enregistrements: await relais.synchroniserDomaines(), ...(avertissement ? { avertissement } : {}) };
  };
  const deconnecterCf = async () => {
    const enregistrements = cloudflare.connecte() ? await relais.synchroniserDomaines({ retirer: true }) : { faits: [], erreurs: [] };
    magasin.poserSecret('cloudflare', 'jeton', null);
    magasin.poserReglage('cloudflare', { zones: [], actif: false });
    let avertissement = null;
    try { await relais.appliquer(); } catch (e) { avertissement = e.message; }
    return { ok: true, enregistrements, ...(avertissement ? { avertissement } : {}) };
  };

  r.get('/api/health', () => ({ ok: true }), { public: true });

  // ---- état et routes ----
  r.get('/api/etat', ctx => {
    surLesRoutes(ctx, 'lecture');
    return { ...relais.etat(), domaines: magasin.reglage('general').domaines, ip: cfg.ip || null };
  }, { role: 'lecture', jeton: true });

  r.post('/api/routes', async ctx => {
    const qui = surLesRoutes(ctx, 'admin');
    const b = await corps(ctx, S.route);
    const out = await relais.creer(b, { proprietaire: qui.type === 'session' ? null : qui.type === 'hub' ? 'hub' : `service:${qui.nom}` });
    tracer(ctx, qui, 'route.creee', out.route.hote, { cible: out.route.cible, mode: out.route.mode, cf: out.route.cf });
    return out;
  }, { role: 'admin', jeton: true });

  r.patch('/api/routes/:id', async ctx => {
    const qui = surLesRoutes(ctx, 'admin');
    const b = await corps(ctx, S.routeModif);
    const out = await relais.modifier(route(ctx.params.id).id, b);
    tracer(ctx, qui, 'route.modifiee', out.route.hote, b);
    return out;
  }, { role: 'admin', jeton: true });

  r.del('/api/routes/:id', async ctx => {
    const qui = surLesRoutes(ctx, 'admin');
    const x = route(ctx.params.id);
    const out = await relais.retirer(x.id);
    tracer(ctx, qui, 'route.retiree', x.hote);
    return out;
  }, { role: 'admin', jeton: true });

  r.post('/api/routes/:id/sonder', async ctx => { surLesRoutes(ctx, 'lecture'); return relais.sonder(route(ctx.params.id)); }, { role: 'lecture', jeton: true });

  r.post('/api/appliquer', async ctx => {
    const qui = surLesRoutes(ctx, 'admin');
    await relais.appliquer();
    tracer(ctx, qui, 'caddy.applique', 'configuration');
    relais.sonderTout().catch(() => {});
    return { ok: true };
  }, { role: 'admin', jeton: true });

  // Telle que Caddy la reçoit, moins le jeton Cloudflare du défi DNS : un secret scellé ne redescend jamais.
  r.get('/api/configuration', ctx => {
    session(ctx, { role: 'admin' });
    const conf = relais.configuration();
    for (const p of conf.apps.tls?.automation?.policies || []) {
      for (const i of p.issuers || []) if (i.challenges?.dns?.provider?.api_token) i.challenges.dns.provider.api_token = '(scellé)';
    }
    return conf;
  }, { role: 'admin' });

  // Le certificat racine du mode local : à installer sur les postes.
  r.get('/api/autorite', async ctx => {
    surLesRoutes(ctx, 'lecture');
    const pem = await relais.caddy.racine();
    ctx.res.writeHead(200, { 'Content-Type': 'application/x-pem-file', 'Content-Disposition': 'attachment; filename="relay-autorite.crt"', 'Cache-Control': 'no-store' });
    ctx.res.end(pem);
  }, { role: 'lecture', jeton: true });

  // ---- publication par le Hub ----
  // Idempotente : appelée à chaque (re)déploiement d'un service, elle crée la
  // route la première fois et la met à jour ensuite. Un nom tenu par un autre
  // propriétaire n'est jamais pris.
  r.put('/api/hub/publication', async ctx => {
    hub(ctx);
    const b = await corps(ctx, S.publication);
    const base = domaineDeBase();
    const hote = (b.hote || (b.sousDomaine && base ? `${b.sousDomaine}.${base}` : '')).toLowerCase();
    if (!hote) throw new ErreurHttp(400, 'Indique le nom complet, ou un sous-domaine une fois un domaine de base posé dans Relay.');
    const proprietaire = `hub:${b.service}`;
    const mode = b.mode === 'cloudflare' ? 'clair' : (b.mode || 'local');
    const cf = b.mode === 'cloudflare';
    const existe = magasin.routeParHote(hote);
    if (existe && existe.proprietaire !== proprietaire) throw new ErreurHttp(409, `${hote} est déjà servi par une autre route.`);
    const out = existe
      ? await relais.modifier(existe.id, { cible: b.cible, mode, cf, ...(b.nom ? { nom: b.nom } : {}) })
      : await relais.creer({ hote, cible: b.cible, mode, cf, nom: b.nom || b.service }, { proprietaire });
    journal.ecrire({ acteur: 'hub', action: existe ? 'publication.maj' : 'publication.creee', objet: hote, ip: ctx.ip, details: { service: b.service, cible: b.cible, mode } });
    return { ...out, url: `${mode === 'clair' && !cf ? 'http' : 'https'}://${hote}` };
  }, { role: 'admin', jeton: true });

  r.del('/api/hub/publication', async ctx => {
    hub(ctx);
    const { service: nom, hote } = ctx.q;
    const siennes = magasin.routes().filter(x => x.proprietaire === `hub:${nom}` && (!hote || x.hote === hote));
    for (const x of siennes) await relais.retirer(x.id);
    journal.ecrire({ acteur: 'hub', action: 'publication.retiree', objet: nom, ip: ctx.ip, details: { routes: siennes.map(x => x.hote) } });
    return { ok: true, retirees: siennes.map(x => x.hote) };
  }, { role: 'admin', jeton: true, requete: { service: T(40, { requis: true, motif: NOM_SERVICE }), hote: T(253, { motif: HOTE }) } });

  // ---- services raccordés (jetons) ----
  r.get('/api/clients', ctx => { session(ctx, { role: 'admin' }); return { clients: magasin.clients() }; }, { role: 'admin' });
  r.post('/api/clients', async ctx => {
    const s = session(ctx, { role: 'admin', renfort: true });
    const b = await corps(ctx, S.client);
    if (magasin.client(b.nom)) throw new ErreurHttp(409, `Un service s’appelle déjà ${b.nom}.`);
    const out = magasin.creerClient(b.nom, b.portee);
    journal.ecrire({ acteur: s.compte, action: 'client.cree', objet: b.nom, ip: ctx.ip, details: { portee: b.portee } });
    // Montré une seule fois : seule son empreinte est gardée.
    return out;
  }, { role: 'admin' });
  r.post('/api/clients/:id/tourner', async ctx => {
    const s = session(ctx, { role: 'admin', renfort: true });
    await corps(ctx, {});
    const c = magasin.client(ctx.params.id) || (() => { throw new ErreurHttp(404, 'Service inconnu.'); })();
    const out = magasin.tournerClient(c.id);
    journal.ecrire({ acteur: s.compte, action: 'client.tourne', objet: c.nom, ip: ctx.ip });
    return out;
  }, { role: 'admin' });
  r.del('/api/clients/:id', async ctx => {
    const s = session(ctx, { role: 'admin', renfort: true });
    const c = magasin.client(ctx.params.id) || (() => { throw new ErreurHttp(404, 'Service inconnu.'); })();
    // Ses routes partent avec lui : le proxy ne sert pas un orphelin.
    const siennes = magasin.routes().filter(x => x.client === c.id);
    for (const x of siennes) await relais.retirer(x.id);
    magasin.retirerClient(c.id);
    journal.ecrire({ acteur: s.compte, action: 'client.revoque', objet: c.nom, ip: ctx.ip, details: { routes: siennes.length } });
    return { ok: true, routes: siennes.length };
  }, { role: 'admin' });

  // ---- publication par un service raccordé (contrat de la 1.x) ----
  r.get('/api/whoami', ctx => {
    const c = service(ctx);
    return { service: c.nom, id: c.id, since: c.cree, routes: magasin.routes().filter(x => x.client === c.id).map(route1x) };
  }, { jeton: true, public: true });
  r.post('/api/heartbeat', async ctx => { const c = service(ctx); await corps(ctx, {}); magasin.vu(c.id); return { ok: true, at: Date.now() }; }, { jeton: true, public: true });
  r.post('/api/register', async ctx => {
    const c = service(ctx);
    const b = await corps(ctx, S.register);
    const base = domaineDeBase();
    const hote = String(b.host || (b.subdomain && base ? `${b.subdomain}.${base}` : '')).toLowerCase();
    if (!hote) throw new ErreurHttp(400, 'Give host, or subdomain with a base domain configured.');
    const mode = b.mode || 'cloudflare';
    const champs = { cible: b.upstream, mode: MODE_REGISTER[mode], cf: mode === 'cloudflare' && cloudflare.actif(), nom: b.name || c.nom };
    const mienne = magasin.routes().find(x => x.client === c.id && x.hote === hote);
    if (!mienne && magasin.routeParHote(hote)) throw new ErreurHttp(409, `${hote} is already routed by another service.`);
    const out = mienne ? await relais.modifier(mienne.id, champs) : await relais.creer({ hote, ...champs }, { proprietaire: `service:${c.nom}`, client: c.id });
    journal.ecrire({ acteur: `service:${c.nom}`, action: mienne ? 'register.maj' : 'register.cree', objet: hote, ip: ctx.ip });
    return { ok: true, [mienne ? 'updated' : 'created']: true, url: `https://${hote}`, route: route1x(out.route), warning: out.avertissement || null };
  }, { jeton: true, public: true });
  r.del('/api/register', async ctx => {
    const c = service(ctx);
    const hote = ctx.q.host?.toLowerCase();
    const siennes = magasin.routes().filter(x => x.client === c.id && (!hote || x.hote === hote));
    if (!siennes.length) throw new ErreurHttp(404, 'Nothing registered under that name.');
    for (const x of siennes) await relais.retirer(x.id);
    journal.ecrire({ acteur: `service:${c.nom}`, action: 'register.retire', objet: hote || 'tout', ip: ctx.ip });
    return { ok: true, removed: siennes.map(x => x.hote) };
  }, { jeton: true, public: true, requete: { host: T(253, { motif: HOTE }) } });

  // ---- réglages ----
  r.get('/api/reglages', ctx => {
    session(ctx, { role: 'admin' });
    return {
      general: magasin.reglage('general'),
      telegram: { ...magasin.reglagePublic('telegram'), statut: telegram.statut, liaison: telegram.liaison && telegram.liaison.expire > Date.now() ? telegram.liaison.code : null },
      cloudflare: magasin.reglagePublic('cloudflare'),
    };
  }, { role: 'admin' });

  // Domaines de base, contact Let's Encrypt, cadence des sondes : la forme du
  // routage, sans secret. Le Hub les règle aussi, depuis sa page Connexions.
  r.put('/api/reglages/general', async ctx => {
    const qui = surLesRoutes(ctx, 'admin');
    const b = await corps(ctx, S.general);
    const n = magasin.poserReglage('general', b);
    tracer(ctx, qui, 'reglages.general', 'general', b);
    if ('acme' in b) relais.appliquer().catch(() => {});
    if ('domaines' in b) { try { relais.ecrireDns(); } catch { /* repris au prochain tour */ } }
    return n;
  }, { role: 'admin', jeton: true });

  r.put('/api/reglages/telegram', async ctx => {
    const s = session(ctx, { role: 'admin' });
    const b = await corps(ctx, S.telegram);
    // Changer le jeton du bot, ou délier le chat, détourne les alertes : renfort.
    if (b.jeton || b.retirerJeton || b.retirerChat) portail.exiger(ctx, { role: 'admin', renfort: true });
    if (b.jeton) {
      const t = await telegram.identifier(b.jeton);
      if (!t.ok) throw new ErreurHttp(400, `Telegram refuse ce jeton : ${t.erreur}`);
      magasin.poserSecret('telegram', 'jeton', b.jeton);
    }
    if (b.retirerJeton) magasin.poserSecret('telegram', 'jeton', null);
    const n = magasin.poserReglage('telegram', {
      ...('alertes' in b ? { alertes: b.alertes } : {}), ...('commandes' in b ? { commandes: b.commandes } : {}), ...(b.retirerChat ? { chat: '' } : {}),
    });
    telegram.arreter();
    setTimeout(() => telegram.demarrer(), 100);
    journal.ecrire({ acteur: s.compte, action: 'reglages.telegram', objet: 'telegram', ip: ctx.ip, details: { jeton: !!b.jeton, retirerJeton: !!b.retirerJeton, alertes: n.alertes, commandes: n.commandes } });
    return magasin.reglagePublic('telegram');
  }, { role: 'admin' });

  r.post('/api/telegram/lier', async ctx => {
    session(ctx, { role: 'admin', renfort: true });
    await corps(ctx, {});
    if (!magasin.secret('telegram', 'jeton')) throw new ErreurHttp(409, 'Enregistre d’abord le jeton du bot.');
    const l = telegram.lier();
    return { code: l.code, expire: l.expire, bot: telegram.statut.bot };
  }, { role: 'admin' });

  r.post('/api/telegram/essai', async ctx => {
    session(ctx, { role: 'admin' });
    await corps(ctx, S.essaiTg);
    const out = await telegram.envoyer('🧪 <b>Relay</b> — message d’essai.');
    if (!out.ok) throw refusExterne(out.erreur);
    return out;
  }, { role: 'admin' });

  r.put('/api/reglages/cloudflare', async ctx => {
    const s = session(ctx, { role: 'admin' });
    const b = await corps(ctx, S.cloudflare);
    if (b.jeton || b.retirerJeton || 'compte' in b || 'tunnel' in b) portail.exiger(ctx, { role: 'admin', renfort: true });
    const { jeton, retirerJeton, ...reste } = b;
    if (jeton) await connecterCf(jeton);
    if (retirerJeton) await deconnecterCf();
    magasin.poserReglage('cloudflare', reste);
    journal.ecrire({ acteur: s.compte, action: 'reglages.cloudflare', objet: 'cloudflare', ip: ctx.ip, details: { ...reste, jeton: !!jeton, retirerJeton: !!retirerJeton } });
    return magasin.reglagePublic('cloudflare');
  }, { role: 'admin' });

  // Le jeton Cloudflare depuis le Hub : écrit, jamais relu. Le Hub règle déjà
  // tout Relay (il le déploie) : ce droit ne lui donne rien de plus.
  r.put('/api/hub/cloudflare', async ctx => {
    hub(ctx);
    const b = await corps(ctx, S.cloudflareHub);
    const out = await connecterCf(b.jeton);
    journal.ecrire({ acteur: 'hub', action: 'cloudflare.connecte', objet: 'cloudflare', ip: ctx.ip, details: { zones: out.zones } });
    return out;
  }, { role: 'admin', jeton: true });
  r.del('/api/hub/cloudflare', async ctx => {
    hub(ctx);
    const out = await deconnecterCf();
    journal.ecrire({ acteur: 'hub', action: 'cloudflare.deconnecte', objet: 'cloudflare', ip: ctx.ip });
    return out;
  }, { role: 'admin', jeton: true });

  // Le tunnel depuis le Hub : le compte est celui des zones connectées, le
  // tunnel est choisi parmi les siens ou créé. Le jeton du connecteur revient
  // au Hub, qui le scelle dans les réglages de Relay et lance cloudflared.
  r.get('/api/hub/cloudflare/tunnel', async ctx => {
    hub(ctx);
    const c = cloudflare.reglage;
    if (!cloudflare.connecte()) return { connecte: false, actif: false, tunnels: [] };
    let compte = null, tunnels = [], erreur = null;
    try {
      compte = c.compte ? { id: c.compte, nom: c.nomCompte || '' } : await cloudflare.compteDesZones();
      tunnels = await cloudflare.tunnelsDuCompte(compte.id);
    } catch (e) { erreur = e.message; }
    return { connecte: true, actif: cloudflare.actif(), compte, tunnel: c.tunnel ? { id: c.tunnel, nom: c.nomTunnel || '' } : null, tunnels, erreur };
  }, { role: 'admin', jeton: true });
  r.put('/api/hub/cloudflare/tunnel', async ctx => {
    hub(ctx);
    const b = await corps(ctx, S.tunnelHub);
    if (!cloudflare.connecte()) throw new ErreurHttp(409, 'Connecte d’abord Cloudflare avec un jeton d’API.');
    if (!b.tunnel === !b.nom) throw new ErreurHttp(400, 'Choisis un tunnel existant, ou donne le nom d’un nouveau.');
    let compte, t, jeton;
    try {
      compte = await cloudflare.compteDesZones();
      if (b.tunnel) {
        t = (await cloudflare.tunnelsDuCompte(compte.id)).find(x => x.id === b.tunnel);
        if (!t) throw new ErreurHttp(404, 'Ce tunnel n’existe pas dans le compte des zones connectées.');
      } else t = await cloudflare.creerTunnel(compte.id, b.nom);
      jeton = await cloudflare.jetonTunnel(compte.id, t.id);
    } catch (e) { if (e instanceof ErreurHttp) throw e; throw refusExterne(e.message); }
    magasin.poserReglage('cloudflare', { compte: compte.id, nomCompte: compte.nom, tunnel: t.id, nomTunnel: t.nom, actif: true });
    journal.ecrire({ acteur: 'hub', action: 'cloudflare.tunnel', objet: t.nom, ip: ctx.ip, details: { tunnel: t.id, cree: !b.tunnel } });
    return { compte, tunnel: t, jeton };
  }, { role: 'admin', jeton: true });
  r.del('/api/hub/cloudflare/tunnel', async ctx => {
    hub(ctx);
    magasin.poserReglage('cloudflare', { actif: false });
    journal.ecrire({ acteur: 'hub', action: 'cloudflare.tunnel_coupe', objet: 'cloudflare', ip: ctx.ip });
    return { actif: false };
  }, { role: 'admin', jeton: true });

  r.post('/api/cloudflare/essai', async ctx => {
    session(ctx, { role: 'admin' });
    const b = await corps(ctx, S.essaiCf);
    try { return { comptes: await cloudflare.decouvrir(b.jeton || undefined) }; } catch (e) { throw refusExterne(e.message); }
  }, { role: 'admin' });

  r.post('/api/cloudflare/apercu', async ctx => {
    surLesRoutes(ctx, 'admin');
    const b = await corps(ctx, S.apercu);
    try { return await cloudflare.ingress(b.hote, true, { apercu: true }); } catch (e) { throw refusExterne(e.message); }
  }, { role: 'admin', jeton: true });

  r.post('/api/cloudflare/synchroniser', async ctx => {
    const qui = surLesRoutes(ctx, 'admin');
    await corps(ctx, {});
    if (!cloudflare.actif()) throw new ErreurHttp(409, 'Cloudflare Tunnel n’est pas activé.');
    const faits = [], erreurs = [];
    for (const x of magasin.routes().filter(y => y.cf)) {
      try { await cloudflare.publier(x.hote); faits.push(x.hote); } catch (e) { erreurs.push({ hote: x.hote, erreur: e.message }); }
    }
    tracer(ctx, qui, 'cloudflare.synchronise', 'tunnel', { faits: faits.length, erreurs: erreurs.length });
    return { faits, erreurs };
  }, { role: 'admin', jeton: true });

  return {
    async traiter(ctx) {
      const p = ctx.url.pathname;
      if (!p.startsWith('/api/')) return false;
      const t = r.trouver(ctx.req.method, p);
      if (!t) throw new ErreurHttp(404, 'Route inconnue.');
      if (t.methodes) { ctx.res.setHeader('Allow', t.methodes.join(', ')); throw new ErreurHttp(405, 'Méthode non admise.'); }
      if (Object.values(t.params).some(v => !REF.test(v) && !NOM_SERVICE.test(v))) throw new ErreurHttp(404, 'Introuvable.');
      ctx.params = t.params;
      const schema = t.route.options?.requete;
      if (!schema && ctx.url.search) throw new ErreurHttp(400, 'Paramètres de requête inattendus.');
      Object.defineProperty(ctx, 'q', { configurable: true, get: () => valider(Object.fromEntries(ctx.url.searchParams), schema || {}) });
      let reponse;
      try { reponse = await t.route.gestionnaire(ctx); } catch (e) {
        // Caddy ou Cloudflare a refusé : leur message nomme la vraie cause, il
        // remonte tel quel (à un appelant déjà authentifié).
        if (e?.status === 502 && !(e instanceof ErreurHttp)) { repondreJson(ctx.res, 502, { error: e.message }); return true; }
        throw e;
      }
      if (reponse !== undefined) repondreJson(ctx.res, 200, reponse);
      return true;
    },
    routeur: r,
  };
}
