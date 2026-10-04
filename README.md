# Relay

Le relais auto-hébergé : un nom par service, servi en HTTPS ou par un tunnel
Cloudflare, avec la santé de chaque cible et des alertes Telegram. Installé
depuis le Hub, il ajoute au Hub la page **Connexions** et publie seul chaque
service que le Hub installe.

Deux conteneurs :

- **relay-caddy** — le trafic (ports 80 et 443). Le binaire officiel de Caddy,
  vérifié par son empreinte, seul sur une image vide, sans root ni capacité.
  Son API d'administration n'écoute que sur un socket Unix, dans un volume que
  seul Relay partage avec lui.
- **relay** — les routes, l'interface et l'API. Node sans dépendance, sur le
  socle commun (comptes, clés d'accès, TOTP, journal, coffre).

## Modes d'une route

| Mode | Certificat | Quand |
|---|---|---|
| Local | signé par l'autorité interne de Caddy | un nom qui ne sort pas du réseau (`home.arpa`, `lan`) — installe le « Certificat local » sur les postes |
| Public | Let's Encrypt | le nom pointe sur cette machine et 80/443 sont ouverts depuis Internet |
| Sans TLS | aucun (HTTP sur le port 80) | derrière le tunnel Cloudflare ou un autre relais |

Une route publiée par le tunnel passe d'elle-même en « sans TLS » : c'est
Cloudflare qui porte le HTTPS, et le mode public ferait boucler la redirection.

## Avec le Hub

1. Hub → Extensions → Catalogue → **Relay** → Installer. Seul réglage demandé :
   l'adresse IP de la machine.
2. Hub → Comptes des services → Relay → « Créer l'administrateur ».
3. Dans Relay → Réglages : le domaine de base (ex. `home.arpa` ou ton domaine).
4. La page **Connexions** du Hub apparaît : chaque service installé y a sa
   route, et « Publier » en ajoute une pour ceux qui n'en ont pas.

Le Hub parle à Relay avec son propre jeton : routes et publication, jamais les
comptes, les jetons de services ni les réglages (Cloudflare, Telegram), qui
restent dans l'interface de Relay, sous renfort.

## Services qui se publient eux-mêmes

Relay → Services raccordés → « Raccorder un service » : un jeton par service,
montré une fois. Le contrat (`POST /api/register`, idempotent) est dans
[INTEGRATION.md](INTEGRATION.md) ; il est inchangé depuis la 1.x.

## Reprise d'un Relay 1.x

Monter l'ancien dossier `data/` en lecture seule et poser `RELAY_REPRISE` sur
son chemin : au premier démarrage, Relay reprend les routes, les services
raccordés (leurs jetons restent valables) et les réglages Telegram et
Cloudflare, jetons scellés à l'arrivée. Les routes `docker://` sont à
republier depuis le Hub : Relay 2 ne monte plus le socket Docker.

## Variables

| Variable | Défaut | |
|---|---|---|
| `RELAY_IP` | — | adresse de la machine sur le réseau local |
| `RELAY_HUB_TOKEN` | — | jeton du Hub (généré par le Hub) |
| `RELAY_CADDY_SOCKET` | `/run/caddy/admin.sock` | API d'administration de Caddy |
| `RELAY_CADDY_SERVICE` | `http://relay-caddy:80` | Caddy vu par cloudflared |
| `ACME_EMAIL` | — | contact Let's Encrypt |
| `RELAY_REPRISE` | — | dossier `data/` d'un Relay 1.x |
| `SOCLE_*` | | comptes, clé maîtresse, relais de confiance : voir le socle |
