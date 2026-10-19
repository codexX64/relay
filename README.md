# Relay

Le relais auto-hébergé : un nom par service, servi en HTTPS ou par un tunnel
Cloudflare, avec la santé de chaque cible et des alertes Telegram. Installé
depuis le Hub, il ajoute au Hub la page **Connexions** et publie seul chaque
service que le Hub installe.

Trois conteneurs :

- **relay-caddy** — le trafic (ports 80 et 443). Caddy et son module DNS
  Cloudflare, compilés depuis leurs sources (sommes Go vérifiées), seuls sur
  une image vide, sans root ni capacité.
  Son API d'administration n'écoute que sur un socket Unix, dans un volume que
  seul Relay partage avec lui.
- **relay-dns** — dnsmasq : tous les noms de la zone locale (`home.arpa`)
  mènent à cette machine, le reste est transmis. Sur un Mac, un fichier
  `/etc/resolver/home.arpa` contenant `nameserver <IP de la machine>` suffit.
- **relay** — les routes, l'interface et l'API. Node sans dépendance, sur le
  socle commun (comptes, clés d'accès, TOTP, journal, coffre).

## Modes d'une route

| Mode | Certificat | Quand |
|---|---|---|
| Local | Let's Encrypt par le défi DNS si le domaine est chez Cloudflare (jeton connecté) ; sinon l'autorité interne de Caddy | un nom qui ne sort pas du réseau — chez Cloudflare, rien à installer sur les appareils ; ailleurs (`home.arpa`), le résolveur et le « Certificat local » de Relay sur chaque poste |
| Public | Let's Encrypt | le nom pointe sur cette machine et 80/443 sont ouverts depuis Internet |
| Sans TLS | aucun (HTTP sur le port 80) | derrière le tunnel Cloudflare ou un autre relais |

Une route publiée par le tunnel passe d'elle-même en « sans TLS » : c'est
Cloudflare qui porte le HTTPS, et le mode public ferait boucler la redirection.

## Avec le Hub

1. Hub → Extensions → Catalogue → **Relay** → Installer. Rien à remplir :
   l'adresse de la machine vient du Hub.
2. Hub → Connexions → **Connecter Cloudflare** : un jeton d'API (Zone → DNS →
   Modifier, Zone → Zone → Lire). Chaque nom local d'un domaine du compte reçoit
   un enregistrement A vers la machine (non proxifié, marqué « géré par Relay »)
   et un certificat Let's Encrypt par le défi DNS.
3. Hub → Connexions → **Domaines** : ajoute les domaines (ceux du compte
   Cloudflare, ou `home.arpa`). Chaque route se nomme « nom . domaine ».

Le Hub parle à Relay avec son propre jeton : routes, publication et jeton
Cloudflare (écrit, jamais relu). Jamais les comptes, les jetons de services ni
Telegram, qui restent dans l'interface de Relay, sous renfort.

Le jeton Cloudflare est scellé dans la base de Relay. Caddy le reçoit dans sa
configuration, en mémoire seulement (`persist: false`) : Relay la lui rend à
chaque redémarrage. Un nom local publié chez Cloudflare montre l'adresse
privée de la machine dans le DNS public : il ne s'ouvre que sur ce réseau.

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

## Relay seul

La clé maîtresse vit dans un secret Docker, hors du volume de données, lisible
par l'utilisateur du conteneur (10001) seul. Garder une copie hors ligne de
`secrets/socle_cle` : sans elle, une sauvegarde de la base ne rouvre ni les
secrets TOTP ni les jetons Telegram et Cloudflare.

```bash
cp .env.example .env    # RELAY_IP, RELAY_HUB_TOKEN (openssl rand -hex 24, ou vide sans Hub)
mkdir -p secrets && openssl rand -base64 32 > secrets/socle_cle && : > secrets/socle_cle_ancienne
sudo chown 10001:10001 secrets/socle_cle secrets/socle_cle_ancienne && sudo chmod 400 secrets/socle_cle secrets/socle_cle_ancienne
docker compose up -d --build
docker compose logs relay | grep "Jeton d'installation"
```

Sans `SOCLE_CLE` ni `SOCLE_CLE_FILE`, la clé est créée dans `DATA_DIR/cles`,
ce qui ne convient qu'au développement.

**Relay seul déjà en service avant la 2.3**, la clé dans le volume : la
reprendre telle quelle avant de mettre à jour. Au démarrage suivant, Relay
constate que c'est la même et la retire du volume ; une clé différente arrête
le démarrage au lieu de perdre les secrets.

```bash
mkdir -p secrets && docker compose cp relay:/data/cles/socle.key secrets/socle_cle && : > secrets/socle_cle_ancienne
sudo chown 10001:10001 secrets/socle_cle secrets/socle_cle_ancienne && sudo chmod 400 secrets/socle_cle secrets/socle_cle_ancienne
docker compose up -d --build
``` Installé par le Hub, Relay reçoit la
sienne du coffre du Hub.

**Tourner la clé maîtresse.** La clé actuelle dans `SOCLE_CLE_ANCIENNE` (le
Hub, ou `secrets/socle_cle_ancienne`), une neuve (`openssl rand -base64 32`)
dans `SOCLE_CLE`, puis redémarrer : Relay rescelle chaque secret TOTP et chaque
jeton de ses réglages. Vider ensuite l'ancienne et redémarrer.

## Sauvegardes

Une sauvegarde est un instantané cohérent de la base (routes, services
raccordés, réglages, comptes, journal), chiffré pour une clé publique RSA
(3072 bits au moins) dont la clé privée ne vit **pas** sur la machine de Relay.

```bash
# Une fois, sur le poste qui gardera la clé privée :
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out relay-sauvegarde.pem
openssl pkey -in relay-sauvegarde.pem -pubout -out relay-sauvegarde.pub
# Chaque jour, sur l'hôte de Relay (la clé publique suffit) :
docker exec -i <relay> node src/cli.js sauvegarde < relay-sauvegarde.pub > relay-$(date -u +%F).sauv
# Restauration, sur le poste de la clé privée, dans un fichier neuf :
node src/cli.js restaurer relay-sauvegarde.pem relay.db < relay-AAAA-MM-JJ.sauv
```

Les certificats de Caddy (volume `caddy-data`) ne sont pas dans la sauvegarde :
Caddy les redemande seul.

**Incident.** `docker exec <relay> node src/cli.js secrets retirer` oublie les
jetons Telegram et Cloudflare (ou ceux d'un seul canal) et rend à Caddy sa
configuration sans le jeton Cloudflare ; les révoquer aussi chez leur
fournisseur. Voir SECURITY.md, « Incident runbook ».

## Variables

| Variable | Défaut | |
|---|---|---|
| `RELAY_IP` | adresse de la machine connue du Hub | adresse de la machine sur le réseau local, remplie seule à l’installation par le Hub |
| `RELAY_ZONE` | `home.arpa` | zone dont tous les noms mènent ici |
| `RELAY_HUB_TOKEN` | — | jeton du Hub (généré par le Hub) |
| `RELAY_CADDY_SOCKET` | `/run/caddy/admin.sock` | API d'administration de Caddy |
| `RELAY_CADDY_SERVICE` | `http://relay-caddy:80` | Caddy vu par cloudflared |
| `ACME_EMAIL` | — | contact Let's Encrypt |
| `RELAY_REPRISE` | — | dossier `data/` d'un Relay 1.x |
| `SOCLE_*` | | comptes, clé maîtresse, relais de confiance : voir le socle |
