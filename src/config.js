// Configuration de Relay, lue et validée une fois au démarrage. Les variables
// SOCLE_* (comptes, relais, clé maîtresse) sont lues par le socle. Une valeur
// invalide arrête le processus avec la liste complète des erreurs.
import { lireConfig } from '../socle/src/index.js';

export const VERSION = '2.1.1';

export function lireConfigRelay(env = process.env) {
  return lireConfig({
    port: { env: 'PORT', type: 'entier', min: 0, max: 65535, defaut: 8095 },
    hote: { env: 'HOTE', type: 'chaine', defaut: '0.0.0.0' },
    donnees: { env: 'DATA_DIR', type: 'chaine', defaut: '/data' },
    // L'API d'administration de Caddy, sur un socket Unix partagé avec lui
    // seul : aucun port, aucun autre conteneur ne peut réécrire le proxy.
    caddySocket: { env: 'RELAY_CADDY_SOCKET', type: 'chaine', defaut: '/run/caddy/admin.sock' },
    // Le nom du conteneur Caddy vu du tunnel Cloudflare (cloudflared joint
    // Caddy en clair sur le port 80 du réseau Docker).
    caddyService: { env: 'RELAY_CADDY_SERVICE', type: 'chaine', motif: /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/, defaut: 'http://relay-caddy:80' },
    // Jeton du Hub : toutes les routes (publier les services qu'il installe),
    // jamais les comptes, les jetons de services ni les réglages.
    jetonHub: { env: 'RELAY_HUB_TOKEN', type: 'secret', min: 24 },
    // Adresse de la machine, pour les noms locaux (.lan) et la sonde.
    ip: { env: 'RELAY_IP', type: 'chaine', motif: /^(\d{1,3}\.){3}\d{1,3}$/ },
    // Le dossier que lit le résolveur (dnsmasq --hostsdir) : Relay y écrit ses noms.
    dossierDns: { env: 'RELAY_DNS_DIR', type: 'chaine', defaut: '' },
    acme: { env: 'ACME_EMAIL', type: 'chaine', motif: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
    // Reprise d'un Relay 1.x : son dossier data/ (routes.json, settings.json).
    reprise: { env: 'RELAY_REPRISE', type: 'chaine' },
    // API Cloudflare et Telegram (remplacées dans les essais).
    cfApi: { env: 'RELAY_CF_API', type: 'url', defaut: 'https://api.cloudflare.com/client/v4' },
    tgApi: { env: 'RELAY_TG_API', type: 'url', defaut: 'https://api.telegram.org' },
  }, env);
}
