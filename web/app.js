// Interface de Relay : routes, services raccordés, réglages (domaines,
// Cloudflare Tunnel, Telegram), sécurité et comptes du socle. La porte du
// socle gère la connexion ; le serveur revérifie chaque droit.
//
// Rien n'est injecté comme balisage : tout passe par h(), qui écrit du texte.
import {
  Api, porte, pageSecurite, pageComptes, h, icone, basculeTheme, appliquerTheme,
  toast, confirmer, dialogue, feuille, ajouterPictos,
} from '/socle/compte.js';

// Les logos de Relay, dans la couleur du texte (mêmes tracés que le dossier
// Logo) : la marque seule pour les tuiles et l'écran de connexion, le logo
// complet avec le nom pour la barre.
const LOGO_NS = 'http://www.w3.org/2000/svg';
function dessinLogo(vb, traces, largeur, hauteur, nom) {
  const s = document.createElementNS(LOGO_NS, 'svg');
  s.setAttribute('width', largeur); s.setAttribute('height', hauteur); s.setAttribute('viewBox', vb);
  if (nom) { s.setAttribute('role', 'img'); s.setAttribute('aria-label', nom); } else s.setAttribute('aria-hidden', 'true');
  for (const [d, regle] of traces) {
    const p = document.createElementNS(LOGO_NS, 'path');
    p.setAttribute('d', d); p.setAttribute('fill', 'currentColor');
    if (regle) p.setAttribute('fill-rule', regle);
    s.append(p);
  }
  return s;
}
const LOGO_MARQUE = ['0 0 214 214', [['M204.71 98.49 204.07 92.51 203 86.29 201.53 80.15 199.77 74.4 197.54 68.5 194.94 62.75 191.97 57.17 188.65 51.8 184.99 46.66 181.01 41.76 176.93 37.34 172.37 32.98 167.77 29.11 162.69 25.36 157.38 21.94 151.87 18.87 146.44 16.29 140.58 13.93 134.58 11.96 128.47 10.38 122.57 9.24 116.31 8.44 110.01 8.05 103.99 8.05 97.69 8.44 91.43 9.24 85.53 10.38 79.42 11.96 73.42 13.93 67.56 16.29 62.13 18.87 53.56 23.85 45.53 29.68 38.13 36.28 31.24 43.83 25.35 51.8 20.15 60.6 15.9 69.89 12.71 79.28 11.25 85.12 10.15 91.03 9.41 96.99 9.05 102.99 9 206 37 206 37.01 104.93 37.53 97.43 38.84 90.03 40.95 82.82 43.81 75.88 47.52 69.1 51.82 62.93 56.75 57.27 62.43 52.03 68.47 47.56 74.95 43.77 81.01 41 87.09 38.89 93.34 37.35 99.71 36.38 106.14 36.01 112.58 36.22 119.18 37.07 125.46 38.48 131.59 40.46 137.51 43 143.17 46.07 148.7 49.78 153.69 53.85 158.43 58.52 162.58 63.44 166.25 68.73 170.28 76.07 173.47 84.04 175.61 92.13 176.79 100.64 177 105.79 177 206 205 206 204.99 104.8ZM161.49 89.29 158.6 81.79 154.59 74.62 149.58 68.11 143.83 62.5 137.2 57.66 130.1 53.89 122.54 51.16 114.5 49.5 106.3 49 98.29 49.67 90.45 51.45 82.79 54.4 75.62 58.41 69.24 63.3 65.6 66.82 62.28 70.66 59.32 74.77 56.73 79.13 54.54 83.7 52.77 88.45 51.42 93.34 50.52 98.33 50 105.65 50 206 71 206 71.01 105.12 71.24 101.81 71.78 98.54 72.61 95.34 73.78 92.12 76.18 87.4 79.24 83.08 82.82 79.33 87 76.07 91.61 73.46 96.55 71.55 101.72 70.39 107 70 112.28 70.39 117.45 71.55 122.39 73.46 126.91 76.01 131.09 79.25 134.76 83.08 137.82 87.4 140.22 92.12 141.39 95.34 142.22 98.54 142.76 101.81 142.99 105.12 143 206 164 206 164 105.3 163.3 97.12ZM128.66 98.25 127.01 94.66 124.82 91.46 122.13 88.68 119.01 86.38 115.54 84.64 111.83 83.51 107.92 83.02 104.04 83.19 100.26 84.01 96.66 85.46 93.36 87.48 90.44 90.04 87.99 93.05 86.09 96.42 84.57 100.89 84 105.58 84 206 130 206 130 105.86 129.65 102Z', 'evenodd']]];
const LOGO_TEXTE = ['0 0 1082.55 222', [['M207.99 108.5 207.71 102.49 207.03 96.22 205.94 90 204.45 83.86 202.57 77.84 200.42 72.22 197.8 66.48 194.97 61.17 191.65 55.8 187.99 50.66 184.01 45.76 179.93 41.34 175.37 36.98 170.77 33.11 165.69 29.36 160.38 25.94 154.87 22.87 149.44 20.29 143.58 17.93 137.58 15.96 131.47 14.38 125.57 13.24 119.31 12.44 113.01 12.05 106.69 12.06 100.39 12.47 94.43 13.24 88.23 14.45 82.13 16.05 76.14 18.04 70.56 20.29 64.87 23.01 56.31 28.02 48.3 33.86 40.92 40.49 34.05 48.06 28.18 56.06 23.01 64.87 18.9 73.89 15.71 83.28 14.25 89.12 13.15 95.03 12.41 100.99 12.05 106.99 12 210 40 210 40.01 108.93 40.53 101.43 41.84 94.03 43.95 86.82 46.81 79.88 50.52 73.1 54.82 66.93 59.75 61.27 65.26 56.16 71.29 51.68 77.76 47.87 83.61 45.17 89.68 43.01 96.13 41.39 102.5 40.4 109.14 40.01 115.58 40.22 121.97 41.03 128.26 42.42 134.39 44.39 140.51 47 146.17 50.07 151.7 53.78 156.69 57.85 161.43 62.52 165.58 67.44 169.25 72.73 173.28 80.07 176.47 88.04 178.61 96.13 179.79 104.64 180 109.79 180 210 208 210ZM166.99 108.95 166.28 100.95 164.39 92.95 161.45 85.47 157.39 78.33 152.47 71.98 146.56 66.27 140.05 61.56 132.94 57.82 125.37 55.11 117.32 53.47 109.3 53 101.12 53.7 93.29 55.51 85.63 58.47 78.62 62.41 72.24 67.3 68.6 70.82 65.28 74.66 62.32 78.77 59.73 83.13 57.54 87.7 55.77 92.45 54.42 97.34 53.52 102.33 53 109.65 53 210 74 210 74.01 109.12 74.24 105.81 74.78 102.54 75.61 99.34 76.78 96.12 79.18 91.4 82.24 87.08 85.82 83.33 90 80.07 94.61 77.46 99.55 75.55 104.72 74.39 110 74 115.28 74.39 120.45 75.55 125.39 77.46 129.91 80.01 134.09 83.25 137.76 87.08 140.82 91.4 143.22 96.12 144.39 99.34 145.22 102.54 145.76 105.81 145.99 109.12 146 210 167 210ZM133 109.72 132.62 105.86 131.61 102.12 129.98 98.6 127.78 95.41 125.08 92.63 121.95 90.35 118.47 88.62 114.76 87.5 110.92 87.02 107.04 87.19 103.26 88.01 99.66 89.46 96.36 91.48 93.44 94.04 90.99 97.05 89.09 100.42 87.57 104.89 87 109.58 87 210 133 210Z', 'evenodd'], ['M342.89 103.14H392.37Q401.77 103.14 407.16 98.81Q412.55 94.48 412.55 86.76Q412.55 78.93 407.16 74.65Q401.77 70.37 392.37 70.37H338.2L353.09 54.02V177H319.88V45H396.7Q411.47 45 422.58 50.25Q433.68 55.51 439.9 64.83Q446.11 74.15 446.11 86.76Q446.11 99.01 439.9 108.37Q433.68 117.73 422.58 122.95Q411.47 128.16 396.7 128.16H342.89ZM364.18 115.22H401.76L450.33 177H411.67ZM592.65 98.63V123.37H497.18V98.63ZM519.62 111 510.85 165.52 496.99 149.81H598.39V177H477.58L487.75 111L477.58 45H597.51V72.19H496.99L510.85 56.48ZM657.37 45V162.26L642.47 147.55H741.35V177H624.16V45ZM783.12 150.37V123.58H874.32V150.37ZM851.03 45 911.93 177H876.5L824.34 58.87H834.5L782.33 177H746.9L807.81 45ZM973.93 177V113.04H1007.14V177ZM911.94 45H948.78L998.12 107.59H982.77L1032.03 45H1068.87L1001.17 130.86L979.82 131.2Z']]];
function logoMarque(taille = 16) {
  const s = dessinLogo(LOGO_MARQUE[0], LOGO_MARQUE[1], taille, taille, '');
  s.setAttribute('class', 'logo-marque');
  return s;
}
function logoTexte(hauteur = 20) {
  const s = dessinLogo(LOGO_TEXTE[0], LOGO_TEXTE[1], Math.round(hauteur * 4.8764), hauteur, 'Relay');
  s.setAttribute('class', 'logo-texte');
  return s;
}

appliquerTheme();
const SERVICE = 'Relay';
const api = new Api({ surDeconnexion: () => location.reload() });
const etat = await porte({ api, service: SERVICE, marque: logoMarque(20), sousTitre: 'un nom pour chaque service' });
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
    h('div', { class: 'mark' }, logoTexte(20), h('i', { class: 'pulse' })),
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
      h('div', { class: 'grow1 tronque' }, h('strong', { class: 'tronque', text: r.hote }), h('small', { class: 'tronque', text: `${r.cible}${/^https:/i.test(r.cible) && !r.verifier ? ' (certificat non vérifié)' : ''} · ${r.cf ? 'tunnel Cloudflare' : MODE_COURT[r.mode]} · ${proprietaireTexte(r)}` })),
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

async function pageReglages() {
  const r = await api.get('/api/reglages');
  return h('div', { class: 'page' },
    h('div', { class: 'headrow' }, h('div', {}, h('h1', { class: 'title', text: 'Réglages' }), h('p', { class: 'lede', text: 'Domaines, tunnel Cloudflare et alertes Telegram. Le compte et ses facteurs sont dans Sécurité.' }))),
    h('div', { class: 'reglages' }, carteGeneral(r.general), carteCloudflare(r.cloudflare), carteTelegram(r.telegram)));
}

function carteGeneral(g) {
  const domaines = h('input', { class: 'field', value: g.domaines.join(', '), placeholder: 'exemple.fr, home.arpa', autocomplete: 'off', spellcheck: 'false' });
  const acme = h('input', { class: 'field', type: 'email', value: g.acme, placeholder: 'facultative' });
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
  const jeton = h('input', { class: 'field mono', type: 'password', placeholder: c.jeton ? 'jeton enregistré' : 'jeton d’API (Custom token)', autocomplete: 'off' });
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
    h('p', { class: 'hint mt0', text: `Jeton « Custom token » : Zone → DNS Edit sur ta zone, et Account → Cloudflare Tunnel Edit. Relay ne touche qu’aux entrées qu’il a créées.${c.jeton ? ' Un jeton collé ici remplace celui enregistré.' : ''}` }),
    jeton,
    h('label', { class: 'lbl mt9', text: 'Compte' }), compte,
    h('label', { class: 'lbl mt9', text: 'Tunnel' }), tunnel,
    ligneReglage('Publier par le tunnel', 'Les routes cochées « tunnel » reçoivent leur entrée d’ingress et leur CNAME.', actif),
    h('div', { class: 'actions mt12' },
      h('button', { class: 'btn sm', type: 'button', onclick: tester }, 'Tester le jeton'),
      h('button', { class: 'btn sm', type: 'button', onclick: sur(async () => { const o = await api.post('/api/cloudflare/synchroniser'); toast(`${o.faits.length} nom(s) republié(s)${o.erreurs.length ? `, ${o.erreurs.length} en erreur` : ''}.`, !!o.erreurs.length); }) }, 'Tout republier')),
    h('div', { class: 'actions mt9' }, h('button', { class: 'btn solid', type: 'button', onclick: enregistrer }, 'Enregistrer'))));
}

function carteTelegram(t) {
  const jeton = h('input', { class: 'field mono', type: 'password', placeholder: t.jeton ? 'jeton enregistré' : 'jeton du bot (@BotFather)', autocomplete: 'off' });
  const alertes = interrupteur(t.alertes, 'Alertes');
  const commandes = interrupteur(t.commandes, 'Commandes');
  const statut = h('p', { class: 'hint mt0' });
  const peindreStatut = s => { statut.textContent = `${s.statut?.bot || 'bot inconnu'} · ${s.chat ? 'chat lié' : 'chat non lié'} · ${s.statut?.ecoute ? 'à l’écoute' : 'n’écoute pas'}${s.statut?.erreur ? ' · ' + s.statut.erreur : ''}`; };
  peindreStatut(t);
  return h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Telegram' })), h('div', { class: 'cardbody' },
    statut, jeton,
    t.jeton ? h('p', { class: 'hint', text: 'Un jeton collé ici remplace celui enregistré.' }) : null,
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
