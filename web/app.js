// Interface de Relay : routes, services raccordés, réglages (domaines,
// Cloudflare Tunnel, Telegram), sécurité et comptes du socle. La porte du
// socle gère la connexion ; le serveur revérifie chaque droit.
//
// Rien n'est injecté comme balisage : tout passe par h(), qui écrit du texte.
import {
  Api, porte, pageSecurite, pageComptes, h, icone, basculeTheme, appliquerTheme,
  toast, confirmer, dialogue, feuille, ajouterPictos,
} from '/socle/compte.js';

appliquerTheme();
const SERVICE = 'Relay';
const api = new Api({ surDeconnexion: () => location.reload() });
const etat = await porte({ api, service: SERVICE, sousTitre: 'un nom pour chaque service' });
const moi = etat.session.compte;
const admin = moi.role === 'admin';

ajouterPictos({
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5S14.4 18.1 12 20.5M12 3.5C9.6 5.9 8.4 8.7 8.4 12s1.2 6.1 3.6 8.5"/>',
  prise: '<path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0z"/><path d="M12 16v5"/>',
  reglages: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="7.5" cy="17" r="2.2"/>',
  nuage: '<path d="M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.1 11 3.5 3.5 0 0 0 7 18z"/>',
  avion: '<path d="M21 4 3 11l6 2 2 6 3-4 4 3z"/>',
  telecharger: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  copier: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="M7 5v14l11-7z"/>',
  crayon: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  actions: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
});

const MODES = { local: 'Local — certificat de Relay', public: 'Public — Let\'s Encrypt', clair: 'Sans TLS — derrière un tunnel ou un relais' };
const MODE_COURT = { local: 'local', public: 'public', clair: 'sans TLS' };
const sur = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

const stage = h('div', { class: 'stage' });
const navs = {};
const PAGES = {
  routes: { titre: 'Routes', ic: 'globe', rendre: pageRoutes },
  ...(admin ? {
    services: { titre: 'Services raccordés', ic: 'prise', rendre: pageServices },
    reglages: { titre: 'Réglages', ic: 'reglages', rendre: pageReglages },
  } : {}),
  securite: { titre: 'Sécurité', ic: 'cadenas', rendre: () => pageSecurite(api, { service: SERVICE, confidentialite: '/confidentialite.txt' }) },
  ...(admin ? { comptes: { titre: 'Comptes', ic: 'utilisateurs', rendre: () => pageComptes(api, { service: SERVICE }) } } : {}),
};
const lien = k => (navs[k] = h('button', { class: 'nav', type: 'button', 'aria-label': PAGES[k].titre, onclick: () => aller(k) }, icone(PAGES[k].ic), h('span', { text: PAGES[k].titre })));
const groupe = (nom, cles) => { const l = cles.filter(k => PAGES[k]); return l.length ? h('div', { class: 'grp' }, h('span', { text: nom }), l.map(lien)) : null; };
const railEtat = h('b', { text: '—' });
const railBar = h('i');
const app = h('div', { class: 'app' },
  h('nav', { class: 'rail', 'aria-label': 'Navigation' },
    h('div', { class: 'mark' }, h('div', { class: 'g' }, icone('globe', 15)), h('b', { text: SERVICE }), h('i', { class: 'pulse' })),
    groupe('Connexions', ['routes', 'services']),
    groupe('Système', ['reglages', 'securite', 'comptes']),
    h('div', { class: 'railcard' },
      h('div', { class: 'row' }, icone('globe', 14), h('span', { class: 'tronque', text: 'Répondent' }), railEtat),
      h('div', { class: 'bar' }, railBar),
      h('div', { class: 'row mt11' }, icone('utilisateurs', 14), h('span', { class: 'tronque', text: moi.identifiant })),
      h('button', { class: 'btn sm flat plein', type: 'button', onclick: async () => { await api.post('/api/compte/deconnexion'); location.reload(); } }, icone('sortie', 14), 'Se déconnecter'))),
  h('div', { class: 'voile-rail', onclick: () => app.classList.remove('menu-ouvert') }),
  h('main', { class: 'main' },
    h('header', { class: 'top' },
      h('button', { class: 'ghost menu', type: 'button', 'aria-label': 'Menu', onclick: () => app.classList.toggle('menu-ouvert') }, icone('menu')),
      h('div', { class: 'topright' }, basculeTheme(), h('div', { class: 'who', title: moi.identifiant, text: moi.identifiant.slice(0, 2).toUpperCase() }))),
    stage));
document.body.append(app);

async function aller(k) {
  if (!PAGES[k]) k = 'routes';
  for (const [n, b] of Object.entries(navs)) b.classList.toggle('on', n === k);
  app.classList.remove('menu-ouvert');
  history.replaceState(null, '', '#' + k);
  try { stage.replaceChildren(await PAGES[k].rendre()); } catch (e) { stage.replaceChildren(h('div', { class: 'page' }, h('p', { class: 'erreur', text: e.message }))); }
  stage.scrollTop = 0;
}

function majRail(e) {
  const actives = e.routes.filter(r => r.actif);
  const ok = actives.filter(r => r.sante?.ok).length;
  railEtat.textContent = `${ok} / ${actives.length}`;
  railBar.style.width = (actives.length ? Math.round(ok / actives.length * 100) : 0) + '%';
}

const interrupteur = (marche, libelle, surChange) => {
  const b = h('button', { class: 'toggle', type: 'button', role: 'switch', 'aria-checked': String(!!marche), 'aria-label': libelle }, h('i'));
  b.addEventListener('click', () => { const v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(v)); surChange?.(v); });
  b.valeur = () => b.getAttribute('aria-checked') === 'true';
  return b;
};
const ligneReglage = (titre, aide, controle) => h('div', { class: 'reglage-ligne' }, h('div', {}, h('strong', { text: titre }), aide ? h('small', { text: aide }) : null), controle);
const telecharger = async (chemin, nom) => {
  const r = await fetch(chemin, { credentials: 'same-origin' });
  if (!r.ok) { let m = 'Téléchargement impossible.'; try { m = (await r.json()).error || m; } catch { /* corps non JSON */ } throw new Error(m); }
  const a = h('a', { href: URL.createObjectURL(await r.blob()), download: nom });
  document.body.append(a); a.click(); a.remove();
};

// ---------- routes ----------
// L'état tel qu'un navigateur le vivrait : nom servi par Caddy, cible qui répond en HTTP.
function tagSante(r, caddy) {
  if (!r.actif) return h('span', { class: 'tag idle' }, h('i', { class: 'd' }), 'en pause');
  if (caddy && !caddy.ok) return h('span', { class: 'tag held', title: caddy.erreur || '' }, h('i', { class: 'd' }), 'non servi');
  if (!r.sante) return h('span', { class: 'tag idle' }, h('i', { class: 'd' }), 'sonde à venir');
  if (r.sante.ok) return h('span', { class: 'tag' }, h('i', { class: 'd' }), `en ligne · ${r.sante.ms} ms`);
  return h('span', { class: 'tag held' }, h('i', { class: 'd' }), r.sante.code ? `cible : erreur ${r.sante.code}` : `cible : ${r.sante.erreur || 'injoignable'}`);
}
const proprietaireTexte = r => (r.proprietaire?.startsWith('hub:') ? `Hub · ${r.proprietaire.slice(4)}` : r.proprietaire?.startsWith('service:') ? r.proprietaire.slice(8) : 'à la main');

async function pageRoutes() {
  const e = await api.get('/api/etat');
  majRail(e);
  const liste = h('div', {});
  const peindre = st => {
    liste.replaceChildren(...(st.routes.length ? st.routes.map(r => ligneRoute(r, st)) : [h('p', { class: 'vide', text: 'Aucune route. Le Hub publie chaque service qu’il installe ; tu peux aussi en ajouter une à la main.' })]));
    majRail(st);
  };
  peindre(e);
  const recharger = async () => peindre(await api.get('/api/etat'));
  const caddy = e.caddy.ok ? `Caddy à jour depuis ${new Date(e.caddy.at).toLocaleTimeString('fr-FR')}` : 'Caddy en panne';
  return h('div', { class: 'page' },
    h('div', { class: 'headrow' },
      h('div', {}, h('h1', { class: 'title', text: 'Routes' }), h('p', { class: 'lede', text: 'Un nom, une machine. Chaque nom est servi en HTTPS — certificat de Relay sur le réseau local, Let’s Encrypt en public — ou derrière le tunnel Cloudflare.' })),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onclick: sur(() => telecharger('/api/autorite', 'relay-autorite.crt')) }, icone('telecharger', 15), 'Certificat local'),
        admin ? h('button', { class: 'btn solid', type: 'button', onclick: sur(() => formRoute(null, e, recharger)) }, icone('plus', 15), 'Nouvelle route') : null)),
    h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Noms servis' }), h('span', { class: 'note ' + (e.caddy.ok ? '' : 'erreur'), text: caddy })),
      e.caddy.ok ? null : h('p', { class: 'erreur pad-erreur', role: 'alert', text: `Aucun nom n’est servi : ${e.caddy.erreur}` }), liste),
    h('p', { class: 'hint', text: 'Mode local : installe le « Certificat local » sur chaque poste pour que le navigateur fasse confiance aux noms servis par Relay.' }));

  function ligneRoute(r, st) {
    const acts = admin ? [
      { texte: 'Modifier', agir: () => formRoute(r, st, recharger) },
      { texte: r.actif ? 'Mettre en pause' : 'Reprendre', agir: async () => { await api.patch(`/api/routes/${r.id}`, { actif: !r.actif }); await recharger(); } },
      { texte: 'Sonder', agir: async () => { const s = await api.post(`/api/routes/${r.id}/sonder`); toast(s.ok ? `${r.cible} répond (${s.ms} ms).` : `${r.cible} : ${s.code ? `erreur ${s.code}` : s.erreur || 'injoignable'}.`, !s.ok); await recharger(); } },
      { texte: 'Supprimer', danger: true, agir: async () => { if (await confirmer(`Retirer ${r.hote} ?`, 'Le nom ne sera plus servi par Relay.', { danger: true, oui: 'Retirer' })) { const o = await api.del(`/api/routes/${r.id}`); if (o.avertissement) toast(o.avertissement, true); await recharger(); } } },
    ] : [];
    return h('div', { class: 'flowrow', 'data-donnee': '' },
      h('span', { class: 'itile ' + (r.actif && r.sante?.ok ? 'key' : '') }, icone(r.cf ? 'nuage' : 'globe')),
      h('div', { class: 'grow1 tronque' }, h('strong', { class: 'tronque', text: r.hote }), h('small', { class: 'tronque', text: `${r.cible} · ${r.cf ? 'tunnel Cloudflare' : MODE_COURT[r.mode]} · ${proprietaireTexte(r)}` })),
      h('div', { class: 'fin' }, tagSante(r, st.caddy),
        acts.length ? h('button', { class: 'btn sm flat', type: 'button', 'aria-label': `Actions pour ${r.hote}`, onclick: sur(() => feuille(r.hote, acts.map(a => ({ ...a, agir: sur(a.agir) })))) }, icone('actions', 16)) : null));
  }
}

async function formRoute(r, st, apres) {
  const nouveau = !r;
  // « nom . domaine » : le domaine choisi parmi ceux des réglages ; un nom
  // existant hors de ces domaines garde le sien dans la liste.
  const doms = [...st.domaines];
  let nomInit = '', domInit = doms[0] || '';
  if (r?.hote) {
    const d = doms.filter(x => r.hote.endsWith(`.${x}`)).sort((a, b) => b.length - a.length)[0];
    if (d) { nomInit = r.hote.slice(0, -(d.length + 1)); domInit = d; }
    else { const i = r.hote.indexOf('.'); nomInit = i > 0 ? r.hote.slice(0, i) : r.hote; domInit = i > 0 ? r.hote.slice(i + 1) : ''; if (domInit) doms.push(domInit); }
  }
  const sous = h('input', { class: 'field', maxlength: 190, placeholder: 'nom', value: nomInit, autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Nom' });
  const domaine = h('select', { class: 'field', 'aria-label': 'Domaine' }, doms.length ? doms.map(d => h('option', { value: d, text: d, selected: d === domInit })) : [h('option', { value: '', text: 'aucun domaine' })]);
  const hote = h('div', { class: 'saisie-domaine' }, sous, h('span', { class: 'point', text: '.', 'aria-hidden': 'true' }), domaine);
  const cible = h('input', { class: 'field', maxlength: 300, placeholder: 'hub-mapmylan:8090 ou https://192.0.2.20:8443', value: r?.cible || '', autocomplete: 'off', spellcheck: 'false' });
  const mode = h('select', { class: 'field', 'aria-label': 'Certificat' }, Object.entries(MODES).map(([v, t]) => h('option', { value: v, text: t, selected: (r?.mode || 'local') === v })));
  const cf = interrupteur(r?.cf, 'Publier par le tunnel Cloudflare');
  const verifier = interrupteur(r?.verifier, 'Vérifier le certificat de la cible');
  const entete = h('input', { class: 'field', maxlength: 260, placeholder: 'vide : le nom demandé', value: r?.enteteHote || '' });
  const nom = h('input', { class: 'field', maxlength: 60, placeholder: 'Libellé (facultatif)', value: r?.nom || '' });
  const err = h('p', { class: 'erreur', role: 'alert' });
  const ok = await dialogue({
    titre: nouveau ? 'Nouvelle route' : `Modifier ${r.hote}`, large: true,
    contenu: [
      h('label', { class: 'lbl', text: 'Nom' }), hote,
      h('label', { class: 'lbl mt9', text: 'Cible (vue depuis Relay)' }), cible,
      h('label', { class: 'lbl mt9', text: 'Certificat' }), mode,
      st.cloudflare ? ligneReglage('Tunnel Cloudflare', 'Le nom est publié par le tunnel ; Cloudflare porte le HTTPS.', cf) : null,
      ligneReglage('Vérifier le certificat de la cible', 'Pour une cible en https:// qui a un vrai certificat. Laisse coupé pour une machine au certificat auto-signé.', verifier),
      h('details', { class: 'mt9' }, h('summary', { text: 'Plus de réglages' }),
        h('label', { class: 'lbl mt9', text: 'En-tête Host transmis' }), entete,
        h('label', { class: 'lbl mt9', text: 'Libellé' }), nom),
      err,
    ],
    boutons: [{ texte: 'Annuler', classe: 'flat', valeur: false }, { texte: nouveau ? 'Créer' : 'Enregistrer', classe: 'solid', agir: async () => {
      if (!domaine.value) { err.textContent = 'Ajoute d’abord un domaine dans les réglages.'; return false; }
      const n = sous.value.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
      if (!n) { err.textContent = 'Nom : obligatoire.'; return false; }
      const corps = { hote: `${n}.${domaine.value}`, cible: cible.value.trim(), mode: mode.value, verifier: verifier.valeur(), enteteHote: entete.value.trim(), nom: nom.value.trim(), ...(st.cloudflare ? { cf: cf.valeur() } : {}) };
      try {
        const o = nouveau ? await api.post('/api/routes', corps) : await api.patch(`/api/routes/${r.id}`, corps);
        if (o.avertissement) toast(o.avertissement, true);
        return true;
      } catch (e) { err.textContent = e.message; return false; }
    } }],
  });
  if (ok) { toast(nouveau ? 'Route créée.' : 'Route enregistrée.'); await apres(); }
}

// ---------- services raccordés ----------
async function pageServices() {
  const liste = h('div', {});
  const peindre = async () => {
    const { clients } = await api.get('/api/clients');
    liste.replaceChildren(...(clients.length ? clients.map(ligne) : [h('p', { class: 'vide', text: 'Aucun service raccordé. Le Hub n’en a pas besoin : il a son propre jeton.' })]));
  };
  const ligne = c => {
    const acts = [
      { texte: 'Nouveau jeton', agir: async () => { if (await confirmer(`Remplacer le jeton de ${c.nom} ?`, 'L’ancien cesse de fonctionner tout de suite ; les routes restent.', { oui: 'Remplacer' })) { montrerJeton(c.nom, (await api.post(`/api/clients/${c.id}/tourner`)).jeton); await peindre(); } } },
      { texte: 'Révoquer', danger: true, agir: async () => { if (await confirmer(`Révoquer ${c.nom} ?`, `Son jeton cesse de fonctionner et ses ${c.routes.length} route(s) sont retirées.`, { danger: true, oui: 'Révoquer' })) { await api.del(`/api/clients/${c.id}`); await peindre(); } } },
    ];
    return h('div', { class: 'flowrow', 'data-donnee': '' },
      h('span', { class: 'itile' }, icone('prise')),
      h('div', { class: 'grow1 tronque' }, h('strong', { text: c.nom }), h('small', { class: 'tronque', text: `${c.portee === 'routes' ? 'toutes les routes' : 'ses routes'} · jeton ${c.indice} · ${c.routes.length} route(s) · ${c.vu ? 'vu ' + new Date(c.vu).toLocaleString('fr-FR') : 'jamais vu'}` })),
      h('div', { class: 'fin' }, h('button', { class: 'btn sm flat', type: 'button', 'aria-label': `Actions pour ${c.nom}`, onclick: sur(() => feuille(c.nom, acts.map(a => ({ ...a, agir: sur(a.agir) })))) }, icone('actions', 16))));
  };
  await peindre();
  const nouveau = async () => {
    const nom = h('input', { class: 'field', maxlength: 40, placeholder: 'nom du service (lettres, chiffres, tirets)', autocomplete: 'off', spellcheck: 'false' });
    const portee = h('select', { class: 'field', 'aria-label': 'Portée' }, h('option', { value: 'soi', text: 'Publier ses propres routes' }), h('option', { value: 'routes', text: 'Gérer toutes les routes (gestionnaire de conteneurs)' }));
    const err = h('p', { class: 'erreur', role: 'alert' });
    let jeton = null;
    const ok = await dialogue({ titre: 'Raccorder un service', contenu: [nom, h('div', { class: 'mt9' }, portee), err], boutons: [{ texte: 'Annuler', classe: 'flat', valeur: false }, { texte: 'Créer le jeton', classe: 'solid', agir: async () => {
      try { const o = await api.post('/api/clients', { nom: nom.value.trim().toLowerCase(), portee: portee.value }); jeton = o.jeton; return true; } catch (e) { err.textContent = e.message; return false; }
    } }] });
    if (ok && jeton) { montrerJeton(nom.value.trim().toLowerCase(), jeton); await peindre(); }
  };
  return h('div', { class: 'page' },
    h('div', { class: 'headrow' }, h('div', {}, h('h1', { class: 'title', text: 'Services raccordés' }), h('p', { class: 'lede', text: 'Un jeton par service qui se publie lui-même (POST /api/register). Montré une seule fois ; une fuite ne coûte que ce service.' })),
      h('div', { class: 'actions' }, h('button', { class: 'btn solid', type: 'button', onclick: sur(nouveau) }, icone('plus', 15), 'Raccorder un service'))),
    h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Jetons' })), liste));
}
function montrerJeton(nom, jeton) {
  const champ = h('input', { class: 'field mono', readonly: true, value: jeton, 'aria-label': 'Jeton' });
  dialogue({ titre: `Jeton de ${nom}`, texte: 'Copie-le maintenant : il ne sera plus jamais affiché. Pose-le dans RELAY_TOKEN du service.', contenu: [champ],
    boutons: [{ texte: 'Copier', classe: 'solid', agir: async () => { await navigator.clipboard.writeText(jeton); toast('Jeton copié.'); return true; } }, { texte: 'Fermer', classe: 'flat', valeur: true }] });
}

// ---------- réglages ----------
async function pageReglages() {
  const r = await api.get('/api/reglages');
  return h('div', { class: 'page' },
    h('div', { class: 'headrow' }, h('div', {}, h('h1', { class: 'title', text: 'Réglages' }), h('p', { class: 'lede', text: 'Domaines, tunnel Cloudflare et alertes Telegram. Le compte et ses facteurs sont dans Sécurité.' }))),
    h('div', { class: 'grille' }, carteGeneral(r.general), carteCloudflare(r.cloudflare), carteTelegram(r.telegram)));
}

function carteGeneral(g) {
  const domaines = h('input', { class: 'field', value: g.domaines.join(', '), placeholder: 'exemple.fr, home.arpa', autocomplete: 'off', spellcheck: 'false' });
  const acme = h('input', { class: 'field', type: 'email', value: g.acme, placeholder: 'contact pour Let’s Encrypt (facultatif)' });
  const sonde = h('input', { class: 'field', type: 'number', min: 5, max: 3600, value: g.sondeSecondes });
  return h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Général' })), h('div', { class: 'cardbody' },
    h('label', { class: 'lbl', text: 'Domaines de base' }), domaines,
    h('p', { class: 'hint', text: 'Le premier sert aux services qui ne donnent qu’un sous-domaine (le Hub, /api/register).' }),
    h('label', { class: 'lbl mt9', text: 'Adresse Let’s Encrypt' }), acme,
    h('label', { class: 'lbl mt9', text: 'Sonde des cibles (secondes)' }), sonde,
    h('div', { class: 'actions mt12' }, h('button', { class: 'btn solid', type: 'button', onclick: sur(async () => {
      await api.put('/api/reglages/general', { domaines: domaines.value.split(/[\s,;]+/).map(d => d.trim().toLowerCase()).filter(Boolean), acme: acme.value.trim(), sondeSecondes: Number(sonde.value) });
      toast('Réglages enregistrés.');
    }) }, 'Enregistrer'))));
}

function carteCloudflare(c) {
  const jeton = h('input', { class: 'field mono', type: 'password', placeholder: c.jeton ? 'jeton enregistré — en coller un autre pour le remplacer' : 'jeton d’API (Custom token)', autocomplete: 'off' });
  const compte = h('select', { class: 'field', 'aria-label': 'Compte' }, c.compte ? h('option', { value: c.compte, text: c.nomCompte || c.compte }) : h('option', { value: '', text: 'Teste le jeton pour choisir' }));
  const tunnel = h('select', { class: 'field', 'aria-label': 'Tunnel' }, c.tunnel ? h('option', { value: c.tunnel, text: c.nomTunnel || c.tunnel }) : h('option', { value: '', text: '—' }));
  const actif = interrupteur(c.actif, 'Publier par le tunnel');
  let comptes = [];
  const remplirTunnels = () => {
    const a = comptes.find(x => x.id === compte.value);
    tunnel.replaceChildren(...(a?.tunnels.length ? a.tunnels.map(t => h('option', { value: t.id, text: t.nom, selected: t.id === c.tunnel })) : [h('option', { value: '', text: 'aucun tunnel sur ce compte' })]));
  };
  compte.addEventListener('change', remplirTunnels);
  const tester = sur(async () => {
    comptes = (await api.post('/api/cloudflare/essai', jeton.value.trim() ? { jeton: jeton.value.trim() } : {})).comptes;
    compte.replaceChildren(...comptes.map(a => h('option', { value: a.id, text: a.nom, selected: a.id === c.compte })));
    remplirTunnels();
    toast(`Jeton valide : ${comptes.length} compte(s).`);
  });
  const enregistrer = sur(async () => {
    const a = comptes.find(x => x.id === compte.value), t = a?.tunnels.find(x => x.id === tunnel.value);
    const corps = { actif: actif.valeur(), ...(jeton.value.trim() ? { jeton: jeton.value.trim() } : {}),
      ...(compte.value !== c.compte || tunnel.value !== c.tunnel ? { compte: compte.value, nomCompte: a?.nom || '', tunnel: tunnel.value, nomTunnel: t?.nom || '' } : {}) };
    Object.assign(c, await api.put('/api/reglages/cloudflare', corps));
    jeton.value = '';
    toast('Cloudflare enregistré.');
  });
  return h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Cloudflare Tunnel' }), h('span', { class: 'note', text: c.actif ? 'actif' : 'coupé' })), h('div', { class: 'cardbody' },
    h('p', { class: 'hint mt0', text: 'Jeton « Custom token » : Zone → DNS Edit sur ta zone, et Account → Cloudflare Tunnel Edit. Relay ne touche qu’aux entrées qu’il a créées.' }),
    jeton, h('div', { class: 'row2 mt9' }, compte, tunnel),
    ligneReglage('Publier par le tunnel', 'Les routes cochées « tunnel » reçoivent leur entrée d’ingress et leur CNAME.', actif),
    h('div', { class: 'actions mt12' },
      h('button', { class: 'btn sm', type: 'button', onclick: tester }, 'Tester le jeton'),
      h('button', { class: 'btn sm', type: 'button', onclick: sur(async () => { const o = await api.post('/api/cloudflare/synchroniser'); toast(`${o.faits.length} nom(s) republié(s)${o.erreurs.length ? `, ${o.erreurs.length} en erreur` : ''}.`, !!o.erreurs.length); }) }, 'Tout republier')),
    h('div', { class: 'actions mt9' }, h('button', { class: 'btn solid', type: 'button', onclick: enregistrer }, 'Enregistrer'))));
}

function carteTelegram(t) {
  const jeton = h('input', { class: 'field mono', type: 'password', placeholder: t.jeton ? 'jeton enregistré — en coller un autre pour le remplacer' : 'jeton du bot (@BotFather)', autocomplete: 'off' });
  const alertes = interrupteur(t.alertes, 'Alertes');
  const commandes = interrupteur(t.commandes, 'Commandes');
  const statut = h('p', { class: 'hint mt0' });
  const peindreStatut = s => { statut.textContent = `${s.statut?.bot || 'bot inconnu'} · ${s.chat ? 'chat lié' : 'chat non lié'} · ${s.statut?.ecoute ? 'à l’écoute' : 'n’écoute pas'}${s.statut?.erreur ? ' · ' + s.statut.erreur : ''}`; };
  peindreStatut(t);
  return h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Telegram' })), h('div', { class: 'cardbody' },
    statut, jeton,
    ligneReglage('Alertes', 'Une cible cesse ou reprend de répondre ; Caddy refuse une configuration.', alertes),
    ligneReglage('Commandes', '/etat, /routes, /sonder, /pause, /reprendre, /appliquer — depuis le chat lié seulement.', commandes),
    h('div', { class: 'actions mt12' },
      h('button', { class: 'btn sm', type: 'button', onclick: sur(async () => {
        const o = await api.post('/api/telegram/lier');
        dialogue({ titre: 'Lier ce chat', texte: `Envoie « /lier ${o.code} » à ${o.bot || 'ton bot'} depuis la conversation voulue, dans les dix minutes.`, boutons: [{ texte: 'Fermer', classe: 'solid', valeur: true }] });
      }) }, icone('avion', 14), 'Lier un chat'),
      h('button', { class: 'btn sm', type: 'button', onclick: sur(async () => { await api.post('/api/telegram/essai'); toast('Message envoyé.'); }) }, 'Essai')),
    h('div', { class: 'actions mt9' },
      h('button', { class: 'btn solid', type: 'button', onclick: sur(async () => {
        const o = await api.put('/api/reglages/telegram', { alertes: alertes.valeur(), commandes: commandes.valeur(), ...(jeton.value.trim() ? { jeton: jeton.value.trim() } : {}) });
        jeton.value = ''; peindreStatut({ ...t, ...o }); toast('Telegram enregistré.');
      }) }, 'Enregistrer'))));
}

aller(location.hash.slice(1) || 'routes');
setInterval(async () => { try { majRail(await api.get('/api/etat')); } catch { /* déconnecté : la porte s'en charge */ } }, 30000);
