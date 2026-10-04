// Bot Telegram de Relay : alertes (une route tombe ou revient, Caddy refuse
// une configuration) et, si on l'active, commandes depuis le seul chat lié.
// La liaison se fait par un code à six chiffres affiché dans Relay, valable
// dix minutes : personne d'autre que l'opérateur ne peut s'attacher le bot.
import crypto from 'node:crypto';

const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const MODE = { public: 'public', local: 'local', clair: 'sans TLS' };
const AIDE = [
  '<b>Relay</b>',
  '/etat — ce qui répond en ce moment',
  '/routes — chaque route et son état',
  '/sonder &lt;nom&gt; — sonder une machine tout de suite',
  '/pause &lt;nom&gt; · /reprendre &lt;nom&gt;',
  '/appliquer — repousser la configuration vers Caddy',
].join('\n');

export class Telegram {
  constructor({ magasin, relais, api, journal }) {
    Object.assign(this, { magasin, relais, api, journal });
    this.statut = { ecoute: false, bot: null, ok: false, erreur: 'pas encore démarré', dernier: null };
    this.liaison = null; // { code, expire }
    this.decalage = 0;
    this.enCours = false;
    this.arret = false;
  }

  get reglage() { return this.magasin.reglage('telegram'); }
  jeton() { return this.magasin.secret('telegram', 'jeton'); }

  async appel(methode, corps, jeton = this.jeton(), delai = 8000) {
    const r = await fetch(`${this.api}/bot${jeton}/${methode}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps || {}), signal: AbortSignal.timeout(delai), redirect: 'error',
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.description || `Telegram a répondu ${r.status}.`);
    return j.result;
  }

  async identifier(jeton = this.jeton()) {
    if (!jeton) { this.statut = { ...this.statut, ok: false, bot: null, erreur: 'Aucun jeton de bot.' }; return this.statut; }
    try { const moi = await this.appel('getMe', {}, jeton); this.statut = { ...this.statut, ok: true, bot: '@' + moi.username, erreur: null }; }
    catch (e) { this.statut = { ...this.statut, ok: false, bot: null, erreur: e.message }; }
    return this.statut;
  }

  async envoyer(texte, chat = this.reglage.chat) {
    const jeton = this.jeton();
    if (!jeton || !chat) return { ok: false, erreur: 'Il faut le jeton du bot et un chat lié.' };
    try { await this.appel('sendMessage', { chat_id: chat, text: texte, parse_mode: 'HTML', disable_web_page_preview: true }); return { ok: true }; }
    catch (e) { return { ok: false, erreur: e.message }; }
  }

  /** Une alerte : seulement si elles sont activées. */
  alerte(texte) { if (this.reglage.alertes) this.envoyer(texte).catch(() => {}); }

  lier() {
    this.liaison = { code: String(crypto.randomInt(0, 1e6)).padStart(6, '0'), expire: Date.now() + 10 * 60e3 };
    this.demarrer(true);
    return this.liaison;
  }

  /** Écoute les messages tant qu'une liaison est en attente ou que les commandes sont actives. */
  demarrer(pourLiaison = false) {
    if (this.enCours || !this.jeton()) return;
    if (!pourLiaison && !this.reglage.commandes) return;
    this.enCours = true; this.arret = false;
    (async () => {
      this.statut.ecoute = true;
      await this.identifier();
      while (!this.arret && this.jeton() && (this.reglage.commandes || (this.liaison && this.liaison.expire > Date.now()))) {
        try {
          const maj = await this.appel('getUpdates', { timeout: 25, offset: this.decalage }, this.jeton(), 35000);
          this.statut.ok = true; this.statut.erreur = null;
          for (const u of maj || []) {
            this.decalage = u.update_id + 1;
            const m = u.message;
            if (m?.text) await this.recevoir(String(m.chat.id), m.text.trim());
          }
        } catch (e) {
          this.statut.ok = false;
          this.statut.erreur = /Conflict/.test(e.message) ? 'Un autre programme écoute déjà ce bot : arrête-le, ou crée un second bot.' : e.message;
          await new Promise(r => setTimeout(r, 5000));
        }
      }
      this.enCours = false; this.statut.ecoute = false;
    })();
  }
  arreter() { this.arret = true; }

  async recevoir(chat, texte) {
    this.statut.dernier = Date.now();
    const lie = this.reglage.chat;
    if (!lie || chat !== String(lie)) {
      const m = /^\/lier\s+(\d{6})$/.exec(texte) || /^\/link\s+(\d{6})$/.exec(texte);
      if (m && this.liaison && this.liaison.expire > Date.now() && crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(this.liaison.code))) {
        this.magasin.poserReglage('telegram', { chat });
        this.liaison = null;
        this.journal?.ecrire({ acteur: 'système', action: 'telegram.lie', objet: 'chat', resultat: 'succes' });
        await this.envoyer('✅ <b>Relay</b> — ce chat est lié. /aide pour les commandes.', chat);
      }
      return;
    }
    if (this.reglage.commandes) await this.commande(texte);
  }

  async commande(texte) {
    const [brut, arg] = texte.split(/\s+/);
    const cmd = (brut || '').replace(/@.*$/, '').toLowerCase();
    const route = () => this.magasin.routeParHote(arg);
    const r = this.relais;
    switch (cmd) {
      case '/etat': {
        const actives = this.magasin.routes().filter(x => x.actif);
        const ok = actives.filter(x => r.sante.get(x.id)?.ok);
        const d = r.caddy.dernier;
        return this.envoyer(`<b>Relay</b>\n${ok.length}/${actives.length} cibles répondent\nconfiguration ${d.ok ? 'appliquée' : 'NON appliquée'}`);
      }
      case '/routes': {
        const l = this.magasin.routes();
        if (!l.length) return this.envoyer('Aucune route.');
        return this.envoyer('<b>Routes</b>\n' + l.map(x => `${!x.actif ? '⏸' : r.sante.get(x.id)?.ok ? '🟢' : '🔴'} <b>${esc(x.hote)}</b> → ${esc(x.cible)} <i>${MODE[x.mode]}</i>`).join('\n'));
      }
      case '/sonder': {
        const x = route(); if (!x) return this.envoyer('Route inconnue.');
        const s = await r.sonder(x);
        return this.envoyer(`${s.ok ? '🟢' : '🔴'} <b>${esc(x.hote)}</b> ${s.ok ? s.ms + ' ms' : 'pas de réponse'}`);
      }
      case '/pause': case '/reprendre': {
        const x = route(); if (!x) return this.envoyer('Route inconnue.');
        try { await r.modifier(x.id, { actif: cmd === '/reprendre' }); } catch (e) { return this.envoyer('❌ ' + esc(e.message)); }
        this.journal?.ecrire({ acteur: 'telegram', action: cmd === '/pause' ? 'route.pause' : 'route.reprise_manuelle', objet: x.hote, resultat: 'succes' });
        return this.envoyer(`${cmd === '/pause' ? '⏸' : '▶️'} <b>${esc(x.hote)}</b>`);
      }
      case '/appliquer':
        try { await r.appliquer(); return this.envoyer('✅ Configuration rechargée.'); } catch (e) { return this.envoyer('❌ ' + esc(e.message)); }
      default:
        return this.envoyer(AIDE);
    }
  }
}
