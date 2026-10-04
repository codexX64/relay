// Cloudflare Tunnel : pour chaque route cochée, l'entrée d'ingress du tunnel
// et le CNAME proxifié vers <tunnel>.cfargotunnel.com. Relay ne touche jamais
// une entrée d'ingress qu'il n'a pas écrite pour ce nom, ni un enregistrement
// DNS qui ne pointe pas vers un tunnel ; la règle de repli reste telle quelle.
export class Cloudflare {
  constructor({ magasin, api, service, delai = 12000 }) { Object.assign(this, { magasin, api, service, delai }); }

  get reglage() { return this.magasin.reglage('cloudflare'); }
  actif() { const c = this.reglage; return !!(c.actif && c.jeton && c.tunnel && c.compte); }

  async appel(chemin, opts = {}, jeton = this.magasin.secret('cloudflare', 'jeton')) {
    if (!jeton) throw new Error('Aucun jeton Cloudflare enregistré.');
    let r;
    try {
      r = await fetch(this.api + chemin, { ...opts, headers: { Authorization: 'Bearer ' + jeton, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(this.delai), redirect: 'error' });
    } catch (e) { throw new Error('Cloudflare est injoignable : ' + e.message); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) {
      const e = (j.errors && j.errors[0]) || {};
      throw new Error(e.message ? `Cloudflare : ${e.message}${e.code ? ` (${e.code})` : ''}` : `Cloudflare a répondu ${r.status}.`);
    }
    return j.result;
  }

  /** Vérifie un jeton (celui donné, ou celui enregistré) et liste comptes et tunnels. */
  async decouvrir(jeton) {
    await this.appel('/user/tokens/verify', {}, jeton);
    const comptes = (await this.appel('/accounts?per_page=20', {}, jeton)) || [];
    const out = [];
    for (const a of comptes.slice(0, 10)) {
      let tunnels = [];
      try { tunnels = (await this.appel(`/accounts/${encodeURIComponent(a.id)}/cfd_tunnel?is_deleted=false&per_page=50`, {}, jeton)) || []; } catch { tunnels = []; }
      out.push({ id: a.id, nom: a.name, tunnels: tunnels.map(t => ({ id: t.id, nom: t.name })) });
    }
    return out;
  }

  async zone(hote) {
    const zones = (await this.appel('/zones?per_page=50')) || [];
    const z = zones.filter(x => hote === x.name || hote.endsWith('.' + x.name)).sort((a, b) => b.name.length - a.name.length)[0];
    if (!z) throw new Error(`Aucune zone de ce compte Cloudflare ne couvre ${hote}.`);
    return z;
  }

  // Une règle *.domaine couvre déjà le nom : l'ingress ne change pas.
  static joker(regles, hote) {
    return regles.find(r => r.hostname?.startsWith('*.') && hote.endsWith(r.hostname.slice(1)) && hote !== r.hostname.slice(2));
  }

  /** L'ingress après l'ajout (garder) ou le retrait de ce nom ; écrit sauf en aperçu. */
  async ingress(hote, garder, { apercu = false } = {}) {
    const c = this.reglage;
    if (!c.compte || !c.tunnel) throw new Error('Choisis d’abord un compte et un tunnel.');
    const chemin = `/accounts/${encodeURIComponent(c.compte)}/cfd_tunnel/${encodeURIComponent(c.tunnel)}/configurations`;
    const conf = (await this.appel(chemin)) || {};
    const avant = conf.config?.ingress || [];
    const couvert = Cloudflare.joker(avant, hote);
    if (couvert && !avant.some(r => r.hostname === hote)) return { avant, apres: avant, couvert: couvert.hostname };
    const autres = avant.filter(r => r.hostname && r.hostname !== hote);
    const repli = avant.find(r => !r.hostname) || { service: 'http_status:404' };
    const apres = garder ? [...autres, { hostname: hote, service: this.service }, repli] : [...autres, repli];
    if (!apercu) await this.appel(chemin, { method: 'PUT', body: JSON.stringify({ config: { ...(conf.config || {}), ingress: apres } }) });
    return { avant, apres, couvert: null };
  }

  async publier(hote) {
    const ing = await this.ingress(hote, true);
    const z = await this.zone(hote);
    const cible = `${this.reglage.tunnel}.cfargotunnel.com`;
    const recs = (await this.appel(`/zones/${z.id}/dns_records?name=${encodeURIComponent(hote)}`)) || [];
    const corps = JSON.stringify({ type: 'CNAME', name: hote, content: cible, proxied: true, ttl: 1 });
    const trouve = recs[0];
    if (!trouve) await this.appel(`/zones/${z.id}/dns_records`, { method: 'POST', body: corps });
    else if (trouve.content !== cible || !trouve.proxied) {
      if (trouve.type !== 'CNAME' || !String(trouve.content || '').endsWith('.cfargotunnel.com')) {
        throw new Error(`${hote} a déjà un enregistrement ${trouve.type} vers ${trouve.content} : Relay ne le remplace pas.`);
      }
      await this.appel(`/zones/${z.id}/dns_records/${trouve.id}`, { method: 'PUT', body: corps });
    }
    return { hote, cible, couvertPar: ing.couvert };
  }

  async retirer(hote) {
    await this.ingress(hote, false);
    const z = await this.zone(hote);
    const recs = (await this.appel(`/zones/${z.id}/dns_records?name=${encodeURIComponent(hote)}`)) || [];
    const trouve = recs[0];
    if (trouve && String(trouve.content || '').endsWith('.cfargotunnel.com')) await this.appel(`/zones/${z.id}/dns_records/${trouve.id}`, { method: 'DELETE' });
    return { hote };
  }
}
