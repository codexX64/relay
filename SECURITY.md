# Security compliance — Relay

Standard: Project Baseline Requirements & Security Manual, Edition 2.0 (258 controls)
Audited: 2026-10-20   ·   Owner: Codex64   ·   Status: NON-COMPLIANT

## Summary
| Part | Controls | Pass | Fail | N/A | Unknown |
|---|---|---|---|---|---|
| I — Baseline requirements | 68 | 53 | 13 | 2 | 0 |
| II — Security controls | 190 | 91 | 28 | 71 | 0 |
| Total | 258 | 144 | 41 | 73 | 0 |

Chaque FAIL restant est une action humaine de la liste ci-dessous (aucun défaut de code ouvert) ; la mise en production attend qu’elle soit vide.

## Authentication posture
Les personnes passent par le socle commun, embarqué avec ses essais (rejoués par `npm test`) et vérifié par ses empreintes : quatre facteurs cumulables sur chaque compte — mot de passe (Argon2id, 64 Mio, 3 passes, parallélisme 4, rehachage transparent, liste de fuites locale), application TOTP (RFC 6238, secret scellé AES-256-GCM, rejeu refusé), clés d’accès WebAuthn (vérification de l’utilisateur exigée, vingt par compte) et dix codes de secours de 100 bits hachés en Argon2id ; politique par facteur réglable sans déploiement, clé d’accès requise pour les administrateurs ; aucun compte par défaut (jeton d’installation). Sessions serveur de 256 bits en cookie __Host-, HttpOnly, Secure, SameSite=Strict, douze heures au plus et une heure d’inactivité, renouvelées à chaque changement de niveau, listées par appareil et fermables une à une ou toutes en une requête. Rôles : `lecture` voit les routes, `membre` aussi, `admin` change ce qui est exposé ; renfort (re-vérification de moins de cinq minutes) pour raccorder un service, tourner ou révoquer son jeton, lier Telegram, changer le jeton du bot, le jeton, le compte ou le tunnel Cloudflare. Les machines n’ont pas de session : le Hub présente son jeton (24 caractères au moins, comparé en temps constant) et n’atteint ni les comptes, ni les jetons de services, ni Telegram ; chaque service raccordé présente le sien (192 bits, gardé par son empreinte, montré une fois), de portée « soi » (ses routes) ou « routes » (toutes les routes, sans les réglages ni Cloudflare) ; un jeton présenté ne retombe jamais sur une session, et chaque jeton refusé compte pour l’adresse dans le limiteur persistant du socle.

## Findings (audit of 2.2.0, fixed in 2.3.0 and 2.3.1)
Relay 2.2.0, jamais auditée, relue en lecture seule le 2026-10-20 (code, essais, balayage de l’annexe B, cassures volontaires, sondage exploratoire, parcours navigateur), classée par gravité ; chaque constat corrigé par le commit indiqué, avec son essai de non-régression.

| # | Gravité | Contrôles | Constat | Commits |
|---|---|---|---|---|
| R1 | HIGH | SEC-AUTHZ-001, SEC-AUTHZ-007 | Publier une route au tunnel remplaçait l’entrée d’ingress que l’exploitant avait posée pour ce nom vers un autre service, et le CNAME qui menait à un autre tunnel ; retirer la route les effaçait. Un service raccordé de portée « soi » pouvait ainsi détourner un nom publié à la main chez Cloudflare. | 4e8e273 |
| R2 | HIGH | REQ-CFG-002, SEC-API-004 | `GET /api/configuration` rendait à toute session d’administrateur, sans renfort, le jeton d’API Cloudflare en clair (défi DNS des certificats). | be6da70 |
| R3 | HIGH | SEC-AUTHZ-002 | Un jeton de service de portée « routes » réglait les domaines de base et le contact Let’s Encrypt, et lisait l’ingress du tunnel, contrairement au contrat (INTEGRATION.md : ni les réglages ni Cloudflare). | d0e4b7f, 91ac7a9 |
| R4 | MEDIUM | REQ-WEB-005, SEC-CSRF-004, REQ-DATA-004 | Un service raccordé pouvait publier la boucle locale du relais, une adresse non spécifiée ou de lien local (métadonnées d’un nuage), y compris sous une écriture non canonique ; la cible d’un enregistrement n’allait pas au journal. | f6eb690 |
| R5 | MEDIUM | REQ-AUTH-010, REQ-WEB-008 | Le code de liaison Telegram (six chiffres, dix minutes) acceptait un nombre illimité d’essais de qui écrit au bot. | d10982a |
| R6 | MEDIUM | REQ-CFG-005, SEC-SECRETS-006 | Après une rotation de SOCLE_CLE, les jetons Telegram et Cloudflare restaient scellés sous l’ancienne clé : le démarrage échouait, ou les jetons étaient perdus. | 7f7db55 |
| R7 | MEDIUM | REQ-DATA-003, SEC-LOG-007, SEC-DB-006 | Ni sauvegarde, ni restauration, ni retrait des jetons pour un incident ; le jeton Cloudflare restait dans la mémoire de Caddy après son retrait. | 6a6dc76, 62dacb8 |
| R8 | MEDIUM | SEC-SECRETS-004, SEC-DB-004, SEC-INFRA-004 | Installé seul, Relay gardait sa clé maîtresse dans le volume de données, à côté de ce qu’elle scelle ; conteneurs sans plafond de mémoire ni de journaux. | 5abc872, 9bc52ef |
| R9 | MEDIUM | REQ-WEB-006 | La reprise d’une 1.x passait l’en-tête Host et les noms de services sans contrôle, et marquait la reprise faite quand ses fichiers étaient illisibles. | 9ab201d, d96c0e2 |
| R10 | LOW | REQ-CI-001…006, SEC-TEST-001…003 | Aucune intégration continue ; `npm test` ne passait pas les essais du socle embarqué. | 23e425d, 814e135 |
| R11 | LOW | SEC-PRIV-001, SEC-PRIV-003, REQ-DATA-006 | Notice sans durées ni droits, destinataires incomplets (enregistrements DNS chez Cloudflare, le Hub, le relais SMTP). | 89d0e72 |
| R12 | LOW | SEC-LOG-004 | Un échec d’écriture des noms locaux était tu à chaque tour de réconciliation. | 3af36a0 |
| R13 | LOW | REQ-DATA-002 | Une cible en https:// au certificat non vérifié ne se distinguait pas dans la liste des routes. | 6d3585a |
| R14 | LOW | REQ-ANON-002, REQ-ANON-007 | Essais, vitrine et interface portaient des noms et ports d’exemple propres à une installation personnelle. | 3bf0cc5 |
| R15 | LOW | REQ-CODE-005, REQ-CI-006 | Cinq cassures volontaires passaient les essais (jeton faux non compté, droits du jeton du Hub, nom d’un autre, chat non lié, droits de la base sous un autre masque). | 90cbca0 |
| R16 | LOW | REQ-CODE-002 | Bandeaux de section dans le code. | 29d636d |
| R17 | LOW | SEC-DEP-001, REQ-CI-003, SEC-INFRA-004 | L’image de construction de Caddy suivait une étiquette, et le module DNS Cloudflare sa dernière version publiée : deux constructions de la même version pouvaient différer. Épinglés sur les valeurs relevées à la construction de la 2.3.0. | 4f50a83 |

Suivi du 2026-10-25 (2.3.2) : mise en page. Socle 6f2c864 embarqué : un seul écart entre cartes (`--ecart`, 16 px, 12 px en Console et sur petit écran), deux colonnes finissant à la même ligne, les gammes Exploitation et Lavande, des en-têtes de carte de même hauteur, les cartes des pages Sécurité et Comptes l’une sous l’autre (plus de carte étirée à vide), et un contrôle de mise en page qui relève tout écart différent et toute colonne inégale, sans comparer l’en-tête de page, le sélecteur de vues ni une carte qui finit sa transition de survol. Les Réglages quittent la grille automatique pour trois colonnes, puis deux (Telegram en travers), puis une selon la largeur (`web/relay.css:24`) : à 768 px, une place restait vide à côté de Telegram ; une carte étirée par sa rangée garde son bouton Enregistrer en bas au lieu d’un vide sous lui ; compte et tunnel Cloudflare passent l’un sous l’autre, chacun avec son libellé (« Teste le jeton pour choisir » était coupé) ; les textes indicatifs tiennent dans leur champ, ce qu’ils disaient de plus passe dans l’aide. La vitrine prend sa gamme de `SOCLE_THEME`. Le socle apporte aussi : une clé d’accès ne se propose ni ne s’exige par une adresse IP ou en HTTP simple (le navigateur la refuserait), un administrateur y entre avec ses deux autres facteurs et la clé reste exigée par le nom en HTTPS ; la vérification de dévoilement d’un secret (deux routes du socle sous `/api/compte/devoiler`), que Relay n’emploie pas ; les erreurs 502 à 504 écrites pour l’utilisateur passent telles quelles. Relais de confiance (`SOCLE_PROXYS`) laissé vide par défaut : le Hub y ajoute de lui-même l’adresse exacte du Caddy de Relay sur son réseau ; une plage entière ferait croire aussi les conteneurs voisins et la passerelle Docker, qui choisiraient alors l’adresse que le limiteur et le journal enregistrent. Les références de ligne du tableau sont recalées sur l’arbre. Côté Relay, interface seulement : aucune route de Relay, aucun contrôle ne change de statut. Essais : 27 du service, 77 du socle ; parcours du navigateur dans les quatre gammes (SOMA, Console, Exploitation, Lavande) : 63 écrans × largeurs chacune, 0 défaut, 0 erreur de console.

## Control status
| ID | Severity | Status | Evidence | Notes |
|---|---|---|---|---|
| REQ-AUTH-001 | CRITICAL | PASS | `socle/src/comptes.js:25` ; mot de passe, TOTP, clés et codes de secours cumulables : essai `socle/test/parcours.test.js:159` | socle embarqué, ses essais rejoués par `npm test` et la vérification de Relay (`.github/workflows/verification.yml:30`) ; QR code du TOTP dessiné dans le navigateur (`socle/web/qr.js:240`) |
| REQ-AUTH-002 | CRITICAL | PASS | `socle/src/comptes.js:28` ; `socle/src/index.js:49` ; réglable sans déploiement : `socle/src/portail.js:476` | défaut : mot de passe et TOTP facultatifs, clé requise pour les administrateurs |
| REQ-AUTH-003 | CRITICAL | PASS | `socle/src/webauthn.js:26` ; vingt clés nommées : `socle/src/comptes.js:39` ; renommer et retirer : `socle/src/portail.js:316` | liste avec dates de création et d’usage dans la page Sécurité |
| REQ-AUTH-004 | CRITICAL | PASS | `socle/src/webauthn.js:46` ; origine `socle/src/webauthn.js:47` ; rpIdHash `socle/src/webauthn.js:103` | défi à usage unique lié à la session, UP et UV exigés, signature et compteur vérifiés |
| REQ-AUTH-005 | CRITICAL | PASS | `socle/src/comptes.js:732` ; renfort et fermeture des autres sessions : `socle/src/comptes.js:748` | la notification part à l’adresse vérifiée quand un relais existe (voir REQ-AUTH-014) |
| REQ-AUTH-006 | CRITICAL | PASS | `socle/src/comptes.js:993` ; jeton de 20 minutes, haché, unique : `socle/src/comptes.js:37` | essai `socle/test/parcours.test.js:242` ; rejoué par le runbook (`outils/exercice-incident.mjs:133`) |
| REQ-AUTH-007 | HIGH | PASS | `socle/src/comptes.js:40` ; 100 bits, haché Argon2id, usage unique : `socle/src/comptes.js:532` | alerte « secours.utilise » (courriel si relais, voir REQ-AUTH-014) |
| REQ-AUTH-008 | HIGH | PASS | `socle/src/totp.js:35` ; rejeu refusé : `socle/src/comptes.js:624` | RFC 6238, 6 chiffres, 30 s, ±1 pas, secret scellé AES-256-GCM |
| REQ-AUTH-009 | CRITICAL | PASS | aucune voie SMS ni code par courriel : `grep -rniE "sms\|twilio" socle/src src` → 0 ; connexions possibles : `socle/src/comptes.js:465`, `socle/src/comptes.js:491`, `socle/src/comptes.js:513`, `socle/src/comptes.js:578` | un mot de passe seul n’ouvre qu’une session d’inscription ; ni le jeton du Hub ni un jeton de service n’ouvrent jamais de session humaine |
| REQ-AUTH-010 | CRITICAL | PASS | humains : `socle/src/limiteur.js:20` (SQLite, par adresse et par compte, paliers de verrou, preuve de travail après trois échecs) ; jeton du Hub et jetons de service : l’adresse est contrôlée avant toute comparaison (`src/api.js:60`) et chaque échec compte pour elle dans le même limiteur persistant (`src/api.js:64`) : dix échecs bloquent l’adresse, même pour le bon jeton | essai `test/relay.test.js:164` (« un faux jeton est compté ») ; sondage exploratoire ci-dessous (« jetons inventés en rafale ») |
| REQ-AUTH-011 | HIGH | PASS | vérification leurre : `socle/src/argon.js:110` ; message unique | essai `socle/test/parcours.test.js:81` |
| REQ-AUTH-012 | HIGH | PASS | `socle/src/comptes.js:1032` : l’adresse n’existe que dans le jeton haché tant qu’elle n’est pas vérifiée ; `socle/src/comptes.js:1041` | l’adresse ne sert qu’aux alertes : ni identifiant, ni récupération, ni droit ; pas d’inscription libre (invitation seulement) |
| REQ-AUTH-013 | HIGH | PASS | `socle/src/comptes.js:831` | le premier compte naît administrateur et doit inscrire une clé avant tout accès complet (en HTTPS) |
| REQ-AUTH-014 | MEDIUM | FAIL | `socle/src/notifications.js:97` ; « ce n’était pas moi » : `socle/src/comptes.js:1019` | implémenté et essayé (`socle/test/courriel.test.js:63`) ; ne part que si un relais SMTP est configuré → action H2 |
| REQ-CRYPT-001 | CRITICAL | PASS | `socle/src/argon.js:15` ; 64 Mio, t=3, p=4 par défaut : `socle/src/index.js:42` | Argon2id natif de Node, sel de 16 octets par empreinte |
| REQ-CRYPT-002 | HIGH | PASS | `socle/src/argon.js:72` ; écrit dans la même requête : `socle/src/argon.js:129` | essai `socle/test/crypto.test.js:23` |
| REQ-CRYPT-003 | MEDIUM | N/A | bcrypt absent : `grep -rniE "bcrypt" socle/src src` → 0 ; Argon2id seul |  |
| REQ-CRYPT-004 | HIGH | PASS | `socle/src/motdepasse.js:12`, `socle/src/motdepasse.js:13`, liste de fuites locale `socle/src/motdepasse.js:18` | contrôlé côté serveur, sans règle de composition ni rotation forcée |
| REQ-CRYPT-005 | HIGH | PASS | `socle/src/outils.js:16` ; jetons de service de 192 bits tirés par le serveur (`src/base.js:139`) ; jeton du Hub comparé en temps constant (`src/api.js:61`) ; code de liaison Telegram par `crypto.randomInt` (`src/telegram.js:60`) ; `grep -rnE "Math\.random\|uuidv1" src web` → 0 | références de routes et de services de 72 bits, non secrètes (`src/base.js:11`) |
| REQ-CRYPT-006 | MEDIUM | PASS | jetons de service gardés par leur empreinte SHA-256, cherchés par elle (`src/base.js:138`) : 192 bits aléatoires, une empreinte rapide suffit ; sessions : `socle/src/comptes.js:289` ; jetons que Relay doit rejouer (Telegram, Cloudflare) scellés, jamais hachés : voir REQ-DATA-002 | seul l’indice (quatre derniers caractères) est gardé pour l’affichage |
| REQ-SESS-001 | CRITICAL | PASS | `socle/src/http.js:105` ; __Host- en HTTPS : `socle/src/portail.js:51` | aucune session dans le stockage du navigateur ; Relay n’envoie aucun cookie à Cloudflare ni à Telegram |
| REQ-SESS-002 | CRITICAL | PASS | `socle/src/comptes.js:304` à la connexion, au renfort et à chaque changement de facteur ou de rôle | pas de jeton de rafraîchissement : sessions serveur |
| REQ-SESS-003 | HIGH | PASS | `socle/src/comptes.js:328` ; révocation : `socle/src/portail.js:325` et incident : `socle/src/portail.js:489` | appareil, adresse IP, première et dernière vue |
| REQ-SESS-004 | HIGH | PASS | `socle/src/comptes.js:750` ; déconnexion serveur : `socle/src/portail.js:276` | runbook : `outils/exercice-incident.mjs:104` |
| REQ-SESS-005 | HIGH | PASS | `socle/src/comptes.js:344` ; routes de Relay sous renfort : raccorder un service, tourner ou révoquer son jeton (`src/api.js:219`), lier un chat Telegram, changer ou retirer le jeton du bot et délier le chat (`src/api.js:304`), changer le jeton, le compte ou le tunnel Cloudflare (`src/api.js:339`) | essais `test/relay.test.js:402`, `test/relay.test.js:343` |
| REQ-SESS-006 | MEDIUM | PASS | 12 h absolues, 60 min d’inactivité : `socle/src/index.js:40` | pas de JWT ; aucun flux de longue durée |
| REQ-ANON-001 | CRITICAL | PASS | `git log --all --format="%an <%ae>" \| sort -u` et `--format="%cn <%ce>"` → une ligne chacun, le pseudonyme (annexe B.1.1, B.1.2) | commits en UTC ; identité contrôlée en CI sur chaque nouveau commit (`.github/workflows/verification.yml:91`) |
| REQ-ANON-002 | CRITICAL | FAIL | arbre : annexe B.1 → le nom `.env.local` du `.gitignore` et la mention générique d’un nom en `.lan` ; aucun terme de la liste d’anonymat commune : `git grep` → 0 (B.1.16), historique → 0 (B.1.14, B.1.15) ; aucune adresse privée dans tout l’historique ; noms et ports d’exemple rendus génériques (`3bf0cc5`), les commits non publiés de cette passe réécrits avant publication | l’historique publié (jusqu’à v2.2.0) garde des noms et ports d’exemple d’équipement propres à une installation personnelle : retirés de l’arbre, pas de l’historique ; seul l’exploitant peut décider d’une réécriture ou d’un dépôt neuf → action H12, détail dans le rapport hors dépôt |
| REQ-ANON-003 | CRITICAL | FAIL | liste et crochet global à poser sur le poste de développement ; contrôle CI par secret : `.github/workflows/verification.yml:116` | action H4 |
| REQ-ANON-004 | CRITICAL | PASS | commande de REQ-ANON-004 sur tout l’historique (annexe B.1.3) → 0 ; aucun fichier d’instructions d’outil (B.1.4 à B.1.7) → 0 | contrôlé en CI sur chaque nouveau commit : `.github/workflows/verification.yml:91` |
| REQ-ANON-005 | HIGH | PASS | `package.json:7` sans champ auteur ; `LICENSE:1` | le README décrit le logiciel, jamais une machine ni une personne ; contact de sécurité : le signalement privé du dépôt (`src/main.js:21`) |
| REQ-ANON-006 | HIGH | PASS | `git log --all --name-only --format= \| grep -iE "\.(png\|jpe?g\|pdf\|mp4\|gif\|webp\|ico)$" \| wc -l` → 0 (annexe B.1.13) : aucune image ni document binaire dans tout l’historique ; l’icône est un SVG sans métadonnées (`web/icone.svg:1`) | polices WOFF2 du socle : métadonnées de la fonderie seulement ; captures du parcours navigateur gardées hors dépôt |
| REQ-ANON-007 | HIGH | PASS | comptes « ana », « leo », « lea », « bruno » ; adresses de la plage de documentation (192.0.2.0/24) ; domaines `exemple.fr`, `exemple.org` et `home.arpa` ; jetons et clés d’essai fabriqués (`test/relay.test.js:21`) | noms d’exemple d’équipement retirés de l’arbre (`3bf0cc5`) ; l’historique publié en garde la trace : voir « Anonymity » et le rapport hors dépôt |
| REQ-ANON-008 | MEDIUM | PASS | `git log --all --format=%aI \| grep -v "+00:00$" \| wc -l` → 0 ; `--format=%cI` → 0 (annexe B.1.10, B.1.11) | auteur et validateur en UTC sur tout l’historique |
| REQ-ANON-009 | MEDIUM | FAIL | pages d’erreur sans chemin : `socle/src/http.js:171` ; refus de Caddy et de Cloudflare rendus à un appelant déjà authentifié seulement (`src/api.js:443`) | domaine et WHOIS hors dépôt : action H13 |
| REQ-ANON-010 | MEDIUM | PASS | identité stable et unique, dates réelles (TZ=UTC, jamais antidatées) | aucune politique de contribution externe |
| REQ-CFG-001 | CRITICAL | PASS | gitleaks sur tout l’historique, toutes références comprises, relancé à chaque génération de ce fichier → aucune fuite ; `git grep` de l’annexe B.2 → valeurs d’essai fabriquées ; `-----BEGIN … PRIVATE` → 0 | détail dans l’annexe B ci-dessous |
| REQ-CFG-002 | CRITICAL | PASS | secrets jamais rendus : chaque réglage passe par `reglagePublic`, qui ne dit que si un jeton est posé (`src/base.js:102`) ; la configuration de Caddy lue par l’administrateur sans le jeton Cloudflare du défi DNS (`src/api.js:175`) ; jetons de service montrés une fois et gardés par leur empreinte | essai `test/relay.test.js:506` ; aucune construction : web/ est servi tel quel ; sondage exploratoire ci-dessous (« secret dans les réglages ») |
| REQ-CFG-003 | HIGH | FAIL | VM d’essai et production distinctes (instruction de l’exploitant) | jetons du Hub, jetons Cloudflare et bots Telegram séparés par environnement : action H6 |
| REQ-CFG-004 | HIGH | PASS | `src/config.js:9` sur `socle/src/config.js:14` : jeton du Hub de 24 caractères au moins (`src/config.js:22`), adresse IP, courriel ACME, URL et service de Caddy à leur format exact | aucun mode de débogage ni contournement par variable |
| REQ-CFG-005 | HIGH | PASS | chaque secret, son lieu et sa rotation : section « Secrets inventory » ci-dessous ; SOCLE_CLE tournée, les jetons de Relay rescellés (`src/base.js:62`) ; jetons des réglages retirés sans arrêter le service, Caddy suit (`src/cli.js:57`) ; jeton d’un service tourné sans perdre ses routes | essais `test/relay.test.js:673`, `test/relay.test.js:628` ; runbook joué par `outils/exercice-incident.mjs` (28 vérifications, joué le 2026-10-20 et par `test/incident.test.js:9`) ; jetons chez leurs fournisseurs : actions H5, H6 |
| REQ-CI-001 | CRITICAL | FAIL | essais à chaque poussée (`.github/workflows/verification.yml:30`) ; gitleaks sur tout l’historique (`.github/workflows/verification.yml:79`) | Actions, crochet local et protection de poussée à activer : actions H3, H4 |
| REQ-CI-002 | HIGH | FAIL | CodeQL, requêtes « security-extended » : `.github/workflows/verification.yml:143` | bloquant une fois les Actions actives et le contrôle requis : action H3 |
| REQ-CI-003 | HIGH | FAIL | aucune dépendance npm, contrôlé en CI (`.github/workflows/verification.yml:38`) ; image Node et image de construction de Caddy épinglées par empreinte, module DNS à sa version (`Dockerfile:11`, `Dockerfile:13`, `Dockerfile:22`) ; actions épinglées par commit ; mises à jour proposées, jamais appliquées seules (`.github/dependabot.yml:6`) ; trois images au crible (`.github/workflows/verification.yml:64`) | le dépôt est prêt ; l’exécution en CI, les alertes et le contrôle requis : action H3 |
| REQ-CI-004 | HIGH | FAIL | `.github/workflows/verification.yml:116` | échoue tant que le secret n’existe pas : action H4 |
| REQ-CI-005 | MEDIUM | FAIL | permissions minimales `.github/workflows/verification.yml:16` ; actions épinglées par commit ; aucun secret pour les demandes de fusion | protection de branche : action H3 |
| REQ-CI-006 | MEDIUM | PASS | `test/relay.test.js:571` : chaque route du routeur balayée sans session, en lecture seule et avec un jeton « soi » ; `test/relay.test.js:594` : avec un jeton « routes » et le jeton du Hub, contre la liste de ce que chacun peut faire ; une route ajoutée sans droit déclaré fait échouer l’essai | renforts : `test/relay.test.js:402` ; cassures volontaires : NO-VIBE.md |
| REQ-WEB-001 | CRITICAL | FAIL | HSTS dès que la requête est chiffrée : `socle/src/http.js:88` | l’interface de Relay est publiée par le Hub ou sur la boucle locale (`docker-compose.yml:57`) ; servie en HTTP tant qu’aucun relais TLS n’est posé : action H1 |
| REQ-WEB-002 | HIGH | PASS | chaque page : `src/main.js:75` sur `socle/src/http.js:62` (script-src 'self' et un nonce par requête, object-src 'none', base-uri 'none', frame-ancestors 'none', aucun unsafe-inline ni unsafe-eval) | parcours navigateur du 2026-10-20 (`outils/parcours-navigateur.mjs` contre la vitrine) : 63 écrans et largeurs, aucun défaut de mise en page, aucune erreur en console |
| REQ-WEB-003 | HIGH | PASS | `socle/src/http.js:79`, Referrer-Policy, Permissions-Policy, X-Frame-Options, COOP, CORP, no-store, ni Server ni X-Powered-By (annexe B.4) | HSTS dès HTTPS (H1) |
| REQ-WEB-004 | HIGH | PASS | aucun en-tête CORS émis : `curl -sI -H "Origin: https://evil.example" /api/etat` → aucun Access-Control-* (annexe B.4) | API de même origine pour le navigateur ; le Hub appelle de serveur à serveur |
| REQ-WEB-005 | HIGH | PASS | CSRF : `socle/src/portail.js:98` ; JSON exigé : `socle/src/http.js:122` ; aucun GET n’écrit ; SSRF : un jeton de service ne peut viser ni la boucle locale, ni une adresse non spécifiée ou de lien local (métadonnées d’un nuage), ni leurs écritures non canoniques (`src/relais.js:43`, appliqué par `src/api.js:84`) ; Cloudflare et Telegram : adresses fixes de la configuration, sans redirection (`src/cloudflare.js:38`) | essais `test/relay.test.js:402`, `test/relay.test.js:594` ; sondage exploratoire ci-dessous (P7 à P9) ; une cible posée par un administrateur reste libre : c’est le rôle d’un relais |
| REQ-WEB-006 | CRITICAL | PASS | corps : schéma strict par route, champ inconnu refusé (`src/api.js:18` sur `socle/src/schema.js:69`) ; paramètres de requête : schéma par route, tout paramètre non déclaré refusé (`src/api.js:437`) ; identifiants au format exact avant toute lecture (`src/api.js:434`) ; nom, cible, port et en-tête Host contrôlés (`src/relais.js:17`) ; routes reprises d’une 1.x contrôlées comme une saisie (`src/reprise.js:50`) | essais `test/relay.test.js:154`, `test/relay.test.js:519` ; sondage exploratoire ci-dessous |
| REQ-WEB-007 | HIGH | PASS | requêtes préparées partout ; aucun processus lancé par le serveur (`grep -rnE "child_process\|execFile\|spawn" src` → 0) ; la configuration de Caddy est un objet sérialisé en JSON, jamais un texte assemblé (`src/caddy.js:42`) ; messages Telegram échappés (`src/telegram.js:7`) ; `innerHTML` seulement dans le gabarit du socle, sur du balisage écrit dans le code (`socle/web/gabarit.js:115`) | eval et Function absents ; le fichier des noms locaux n’écrit que des noms passés au motif HOTE (`src/base.js:15`) |
| REQ-WEB-008 | MEDIUM | PASS | débit global par adresse `src/main.js:67` ; 500 routes et 100 services au plus (`src/base.js:19`) ; sondes de 2,5 s (`src/relais.js:198`) ; appels à Caddy, Cloudflare et Telegram sous délai (`src/caddy.js:80`, `src/cloudflare.js:38`) ; cinq codes de liaison Telegram faux annulent le code (`src/telegram.js:9`) | essai `test/relay.test.js:368` |
| REQ-DATA-001 | CRITICAL | PASS | SQLite embarqué, aucun port : `src/base.js:27` ; dossier en 0700 et base en 0600, même sous un masque permissif : `src/base.js:23` | essai `test/relay.test.js:111` |
| REQ-DATA-002 | HIGH | FAIL | jetons des réglages et secrets TOTP scellés AES-256-GCM, sous-clé par usage (`src/base.js:98` sur `socle/src/chiffre.js:60`) ; Cloudflare et Telegram en HTTPS vérifié ; vers une cible en https://, le certificat n’est vérifié que si la route le demande (`src/caddy.js:21`) — choix explicite de l’administrateur, affiché dans la liste des routes (`web/app.js:139`) | restent le chiffrement du disque des hôtes, HTTPS vers l’interface de Relay et la vérification des cibles qui ont un vrai certificat : actions H7, H1, H20 |
| REQ-DATA-003 | HIGH | FAIL | sauvegarde chiffrée pour une clé publique RSA : `src/cli.js:75` ; restauration ailleurs avec la clé privée seule : `src/cli.js:26` ; restauration réelle puis démarrage sur la base restaurée, Caddy servi de nouveau : `outils/exercice-incident.mjs:151` (2026-10-20, instance d’essai) | essai `test/relay.test.js:628` ; planification quotidienne, copie hors hôte, trente jours de garde et restauration datée : action H8 |
| REQ-DATA-004 | HIGH | PASS | socle : connexions, facteurs, rôles, refus (`socle/src/portail.js:110`), verrous du limiteur ; Relay : jetons refusés (`src/api.js:65`), routes créées, changées, retirées avec leur cible, publications du Hub, enregistrements des services avec leur cible (`src/api.js:265`), services raccordés, tournés, révoqués, réglages, liaison Telegram, cibles en panne et reprises, sauvegardes, secrets retirés ; jamais un secret : `socle/src/journal.js:10` | essais `test/relay.test.js:402`, `test/relay.test.js:628` |
| REQ-DATA-005 | MEDIUM | PASS | vigie du socle : `socle/src/vigie.js:11` (connexions, refus, limites, erreurs internes), jetons refusés compris ; runbook d’une page ci-dessous, joué de bout en bout sur une instance lancée comme en production : `outils/exercice-incident.mjs` (28 vérifications, joué le 2026-10-20 et par `test/incident.test.js:9`) — détection au journal, sessions fermées en une requête, jeton du Hub et clé maîtresse tournés, jeton d’un service tourné, secrets retirés, mot de passe forcé, restauration | rotation de SOCLE_CLE : essai `test/relay.test.js:673` ; alertes hors de l’application par courriel : action H2 |
| REQ-DATA-006 | MEDIUM | PASS | `web/confidentialite.txt:7` (chaque donnée, sa finalité, sa durée) ; journal à 365 jours, sessions à douze heures (socle) ; une route vit tant qu’elle existe, un service raccordé emporte ses routes en partant (`src/api.js:240`) ; l’état des cibles en mémoire seulement | export et effacement d’un compte par le socle ; Relay ne garde rien d’un compte hors du socle |
| REQ-DATA-007 | MEDIUM | N/A | aucun envoi de fichier ni import depuis une adresse fournie par un utilisateur : corps JSON seulement (`socle/src/http.js:122`), `grep -rniwE "multipart\|busboy\|formidable" src socle/src` → 0 ; la reprise d’une 1.x lit un dossier monté par l’exploitant, contrôlé comme une saisie |  |
| REQ-CODE-001 | HIGH | PASS | essais de référence relevés avant la passe (19 essais du service, tous verts ; voir NO-VIBE.md) ; surface publique inchangée pour l’interface et le contrat de la 1.x (mêmes routes, mêmes champs, mêmes codes) ; changements de comportement voulus, chacun un correctif : un jeton « routes » n’atteint plus les réglages ni Cloudflare, un jeton de service ne vise plus la boucle locale ni le lien local, Cloudflare ne prend plus le nom d’un autre, la configuration lue ne porte plus le jeton Cloudflare, une reprise illisible arrête le démarrage, Relay installé seul lit sa clé dans un secret Docker | voir NO-VIBE.md |
| REQ-CODE-002 | HIGH | PASS | voir NO-VIBE.md, couche des commentaires |  |
| REQ-CODE-003 | HIGH | PASS | voir NO-VIBE.md, couches structurelle et défensive |  |
| REQ-CODE-004 | HIGH | PASS | voir NO-VIBE.md, profil de style du dépôt |  |
| REQ-CODE-005 | MEDIUM | PASS | cassures volontaires, chacune détectée par au moins un essai : NO-VIBE.md, « Tests » |  |
| REQ-CODE-006 | MEDIUM | PASS | un sujet par commit, message d’une seule ligne dans le style du dépôt : `git log --format=%b v2.2.0..HEAD \| grep -c .` → 0 (aucun corps, aucune ligne de fin) ; aucune mention d’outil (annexe B.1.3) ; le socle embarqué vérifié par ses empreintes (`socle/EMPREINTES:1`) | en UTC sur tout l’historique ; relevés commités seuls, jamais mêlés à un changement |
| GOV-001 | HIGH | PASS | ce document : revue datée, périmètre (258 contrôles), résolution ligne par ligne, deux passes complètes | à refaire à chaque changement généré important |
| GOV-002 | MEDIUM | PASS | section « Inventory » ci-dessous : routes, données, tiers, secrets |  |
| GOV-003 | LOW | FAIL | `socle/src/portail.js:150` ; contact : `src/main.js:21` | Contact et Expires servis par le socle ; activer le signalement privé sur le dépôt : action H3 |
| GOV-004 | MEDIUM | FAIL | VM d’essai distincte de la production (règle de l’exploitant) ; données d’essai fabriquées, faux Caddy et fausses API pour les essais et la vitrine (`outils/vitrine.mjs:1`) | jetons et clés distincts à confirmer : action H6 |
| GOV-005 | HIGH | FAIL | jeton CI éphémère et limité à la lecture (`.github/workflows/verification.yml:16`) ; aucune publication depuis la CI | 2FA sur GitHub, Cloudflare et les consoles des fournisseurs : action H3 |
| SEC-SECRETS-001 | CRITICAL | PASS | gitleaks sur tout l’historique et sur l’arbre → aucune fuite (annexe B.2.1, B.2.2) ; `git grep` de l’annexe B.2.3 → valeurs d’essai fabriquées et gabarits du Hub seulement | gitleaks en CI (H3) |
| SEC-SECRETS-002 | CRITICAL | PASS | aucune variable publique ni construction : web/ servi tel quel, `grep -rnE "\bsk-[A-Za-z0-9_-]{20}\|sk_live\|service_role\|-----BEGIN" web socle/web` → 0 (annexe B.2.5) | rien n’est injecté dans le code servi, sauf le nonce CSP et la gamme : `web/index.html:11` |
| SEC-SECRETS-003 | CRITICAL | PASS | `.gitignore:7` (`.env`, `secrets/`, clés) ; seuls web/ et socle/web sont servis (`src/main.js:81`), tout segment caché → 404 (annexe B.2.6, `/.env` demandé à l’instance d’essai) | secrets d’une installation seule : `secrets/`, ignoré (`.gitignore:8`) ; `.env` hors de l’image (`.dockerignore:12`) |
| SEC-SECRETS-004 | HIGH | PASS | installé par le Hub : secrets posés depuis son coffre (`deploy/compose.hub.yml:101`) ; installé seul : clé maîtresse en secret Docker hors du volume (`docker-compose.yml:66`) ; fichiers acceptés : `socle/src/config.js:5` ; jetons Telegram et Cloudflare saisis dans l’interface (ou par le Hub) et scellés en base | jamais dans la CI |
| SEC-SECRETS-005 | HIGH | FAIL | un jeton par service raccordé, à portée fermée (« soi » ou « routes »), révocable un à un ; jeton du Hub distinct du jeton d’administration des comptes (`hub.json:1`) | jeton Cloudflare restreint aux zones utiles (Zone → DNS → Modifier, Zone → Lire, Tunnel), séparé par environnement : action H6 |
| SEC-SECRETS-006 | HIGH | FAIL | procédures de rotation ci-dessous ; SOCLE_CLE exercée (`test/relay.test.js:673`) ; jeton d’un service tourné (`test/relay.test.js:402`) | jetons vus pendant le développement : action H5 |
| SEC-SECRETS-007 | HIGH | PASS | clé maîtresse de 32 octets aléatoires : `socle/src/chiffre.js:24` ; jeton du Hub de 24 caractères au moins (`src/config.js:22`) ; valeurs d’exemple refusées : `socle/src/config.js:54` | jetons de service tirés par le serveur (voir REQ-CRYPT-005) |
| SEC-SECRETS-008 | MEDIUM | PASS | `src/config.js:9` : une valeur invalide arrête le démarrage avec la liste des erreurs ; aucun mode de débogage ; mode HTTP dégradé affiché en permanence : `socle/web/compte.js:589` |  |
| SEC-AUTH-001 | CRITICAL | PASS | voir REQ-CRYPT-001 |  |
| SEC-AUTH-002 | MEDIUM | PASS | voir REQ-CRYPT-004 |  |
| SEC-AUTH-003 | CRITICAL | PASS | voir REQ-AUTH-010 : humains par adresse et par compte, jeton du Hub et jetons de service par adresse, dans le même limiteur persistant |  |
| SEC-AUTH-004 | MEDIUM | PASS | voir REQ-AUTH-011 |  |
| SEC-AUTH-005 | CRITICAL | PASS | voir REQ-AUTH-006 ; lien depuis l’adresse publique : `socle/src/portail.js:56` | sans adresse publique, l’origine attestée par le navigateur de l’administrateur, contrôlée sur la même requête |
| SEC-AUTH-006 | MEDIUM | PASS | confirmation sur la nouvelle adresse et avis à l’ancienne : `socle/src/comptes.js:1047` | essai `socle/test/courriel.test.js:122` |
| SEC-AUTH-007 | HIGH | PASS | TOTP et clés pour tous, second facteur imposé aux administrateurs : `socle/src/comptes.js:178` | codes de secours toujours émis |
| SEC-AUTH-008 | HIGH | N/A | aucune connexion par fournisseur externe : `grep -rniwE "oauth\|openid\|id_token\|redirect_uri" socle/src src` → 0 |  |
| SEC-AUTH-009 | HIGH | PASS | les liens reçus par courriel demandent un geste : `socle/web/compte.js:452` ; uniques et courts : `socle/src/comptes.js:38` | aucune connexion sans mot de passe par courriel |
| SEC-AUTH-010 | CRITICAL | PASS | chaque route non publique appelle `surLesRoutes()`, `horsServices()`, `session()`, `hub()` ou `service()` en tête, avant de lire son corps (`src/api.js:70`) ; les quatre routes publiques du contrat de la 1.x vérifient leur jeton de service (`src/api.js:89`) | essais `test/relay.test.js:571`, `test/relay.test.js:594` |
| SEC-AUTH-011 | HIGH | PASS | jeton faux → 401 (`src/api.js:66`) ; erreur imprévue réduite à un numéro : `socle/src/http.js:171` | un jeton présenté ne retombe jamais sur la session (sondage exploratoire ci-dessous, P2) |
| SEC-SESS-001 | CRITICAL | PASS | voir REQ-SESS-001 |  |
| SEC-SESS-002 | HIGH | PASS | `grep -rn "localStorage" web socle/web/compte.js` → thème seulement (`socle/web/compte.js:302`), jamais une session |  |
| SEC-SESS-003 | HIGH | PASS | 256 bits : `socle/src/comptes.js:289` | renouvelé à chaque changement de niveau |
| SEC-SESS-004 | HIGH | PASS | voir REQ-SESS-003, REQ-SESS-004 et REQ-SESS-006 |  |
| SEC-SESS-005 | CRITICAL | N/A | aucun JWT : `grep -rniwE "jwt\|jsonwebtoken\|jose" src web socle/src` → 0 |  |
| SEC-SESS-006 | MEDIUM | N/A | aucun jeton de rafraîchissement : sessions serveur (voir SEC-SESS-005) |  |
| SEC-SESS-007 | MEDIUM | PASS | voir REQ-SESS-005 ; avis par courriel via le canal d’alerte | courriel : H2 |
| SEC-AUTHZ-001 | CRITICAL | PASS | un service « soi » ne voit et ne change que ses routes : `whoami` filtre par son identifiant, `register` met à jour la sienne ou refuse le nom d’un autre (`src/api.js:263`), `DELETE /api/register` ne retire que les siennes ; le Hub ne touche que les publications de son service (`src/api.js:201`) ; Cloudflare ne prend ni ne retire le nom qu’un autre tient (`src/cloudflare.js:125`) | essais `test/relay.test.js:402`, `test/relay.test.js:184`, `test/relay.test.js:466` ; sondage exploratoire ci-dessous (P3 à P6) |
| SEC-AUTHZ-002 | CRITICAL | PASS | rôle humain lu en base par le socle (`socle/src/portail.js:120`) ; portées fermées : « soi » = ses routes, « routes » = les routes sans les réglages ni Cloudflare (`src/api.js:78`), Hub = routes, publication, domaines de base et Cloudflare, jamais les comptes, les jetons de services ni Telegram | essais `test/relay.test.js:571`, `test/relay.test.js:594` |
| SEC-AUTHZ-003 | HIGH | PASS | schémas stricts, champ inconnu refusé : `socle/src/schema.js:69` ; le propriétaire d’une route vient de la session, du jeton du Hub ou du jeton de service, jamais du corps (`src/api.js:138`) | sondage exploratoire ci-dessous (« champ inconnu », « prototype pollué ») |
| SEC-AUTHZ-004 | HIGH | PASS | route /api inconnue → 404, méthode inconnue → 405 avec Allow (`src/api.js:433`) ; routes publiques : santé (`src/api.js:127`) et le contrat de la 1.x, qui exige un jeton de service | aucune route de débogage ni de semis ; tables des droits : `test/relay.test.js:571`, `test/relay.test.js:594` |
| SEC-AUTHZ-005 | CRITICAL | N/A | aucune notion de locataire : une instance sert les noms d’un réseau ; `grep -rniwE "tenants?\|organisations?\|workspaces?" src` → 0 |  |
| SEC-AUTHZ-006 | LOW | PASS | références aléatoires de 72 bits pour les routes et les services (`src/base.js:11`), validées au format exact avant toute lecture |  |
| SEC-AUTHZ-007 | HIGH | PASS | invariants tenus par le serveur : un nom n’a qu’une route (`src/relais.js:122`) ; une écriture que Caddy refuse est défaite en base (`src/relais.js:124`) ; une route du tunnel passe en mode sans TLS (sinon la redirection boucle) ; Relay ne remplace jamais un enregistrement DNS ni une entrée d’ingress qu’il n’a pas écrits ; le dernier administrateur garde son rôle (socle) | essais `test/relay.test.js:330`, `test/relay.test.js:466` |
| SEC-AUTHZ-008 | MEDIUM | PASS | rôle et renfort exigés par le serveur, jamais par l’interface : chaque route est refusée appelée directement | essais `test/relay.test.js:571`, `test/relay.test.js:402` |
| SEC-INJ-001 | CRITICAL | PASS | requêtes préparées partout ; aucun texte SQL assemblé à partir d’une valeur (`grep -rnE "prepare\(\`[^\`]*\$\{" src` → 0) | annexe B.3.4 : aucune interpolation de valeur dans le texte SQL |
| SEC-INJ-002 | HIGH | N/A | aucun ORM : node:sqlite, requêtes préparées seulement |  |
| SEC-INJ-003 | HIGH | N/A | aucune base documentaire : SQLite seulement ; JSON rangé en colonne texte |  |
| SEC-INJ-004 | CRITICAL | PASS | aucun processus lancé (`grep -rnE "child_process\|execFile\|spawn" src` → 0) ; Caddy piloté par son API sur un socket Unix, en JSON (`src/caddy.js:80`) ; Cloudflare par son API HTTPS, chemins encodés (`src/cloudflare.js:68`) |  |
| SEC-INJ-005 | HIGH | PASS | `socle/src/http.js:205` ; le seul fichier écrit par Relay hors de sa base porte un nom fixe (`src/relais.js:79`) ; la reprise ne lit que deux noms fixes dans le dossier désigné |  |
| SEC-INJ-006 | HIGH | PASS | aucun gabarit côté serveur ; `grep -rnE "new Function\|node:vm" src socle/src` → 0 | l’interface construit son DOM en texte (voir SEC-XSS-001) |
| SEC-INJ-007 | HIGH | N/A | aucun analyseur XML côté serveur : `grep -rniwE "xml2js\|sax\|libxml\|fast-xml\|DOMParser" src socle/src` → 0 |  |
| SEC-INJ-008 | HIGH | PASS | JSON seulement ; clés de prototype refusées : `socle/src/schema.js:6` ; réponses de Caddy, Cloudflare et Telegram lues champ par champ ; réglages relus avec un repli sur les valeurs par défaut (`src/base.js:45`) |  |
| SEC-XSS-001 | CRITICAL | PASS | interface : DOM construit par `h()` du socle, texte seulement (`socle/web/compte.js:11`) ; noms, cibles et messages de Caddy et Cloudflare posés en texte (`web/app.js:139`) | messages Telegram en HTML échappé (`src/telegram.js:7`) |
| SEC-XSS-002 | HIGH | N/A | aucun texte riche ni Markdown rendu : noms, cibles et messages affichés en texte brut (voir SEC-XSS-001) |  |
| SEC-XSS-003 | HIGH | PASS | aucun eval, setTimeout chaîne ni affectation de location depuis une donnée : `grep -rnE "eval\(\|new Function\|location\.href *=" web socle/web/compte.js` → 0 |  |
| SEC-XSS-004 | HIGH | PASS | voir REQ-WEB-002 |  |
| SEC-XSS-005 | MEDIUM | PASS | seul échange : le Worker de preuve de travail, de même origine : `socle/web/compte.js:236` | aucune écoute de window message |
| SEC-XSS-006 | MEDIUM | PASS | un refus de Caddy ou de Cloudflare : son message, borné (`src/caddy.js:104`), rendu à un appelant authentifié et posé en texte ; erreurs imprévues réduites à un numéro (`socle/src/http.js:171`) |  |
| SEC-XSS-007 | MEDIUM | N/A | aucune redirection pilotée par paramètre ; `curl -sI "/login?next=https://evil.example"` → aucun Location (annexe B.4) |  |
| SEC-XSS-008 | MEDIUM | PASS | aucun script tiers ni CDN : tout est servi par Relay (`grep -rnE "https?://" web/index.html` → 0) | polices servies par le socle |
| SEC-HDR-001 | HIGH | FAIL | voir REQ-WEB-001 | action H1 |
| SEC-HDR-002 | HIGH | PASS | voir REQ-WEB-002 |  |
| SEC-HDR-003 | MEDIUM | PASS | voir REQ-WEB-003 |  |
| SEC-HDR-004 | LOW | PASS | `curl -sI /` : ni Server ni X-Powered-By (annexe B.4) |  |
| SEC-HDR-005 | MEDIUM | PASS | no-store sur l’API et les pages : `socle/src/http.js:150` ; seuls les fichiers publics de l’interface, sous leur gamme de version, sont mis en cache (`src/main.js:81`) | aucun CDN |
| SEC-HDR-006 | CRITICAL | PASS | voir REQ-WEB-004 |  |
| SEC-HDR-007 | HIGH | PASS | voir REQ-SESS-001 |  |
| SEC-CSRF-001 | HIGH | PASS | SameSite=Strict + origine + jeton : `socle/src/portail.js:98` appelé par chaque écriture de session | sondage exploratoire ci-dessous (P19, P20) ; le Hub et les services présentent un jeton en en-tête, que le navigateur n’envoie jamais seul |
| SEC-CSRF-002 | MEDIUM | PASS | `socle/src/http.js:122` | 415 sur tout autre type |
| SEC-CSRF-003 | MEDIUM | PASS | voir REQ-WEB-005 : aucun GET n’écrit | les GET de Relay lisent sa base, l’état de Caddy ou le certificat racine |
| SEC-CSRF-004 | CRITICAL | PASS | adresses que le serveur joint : Caddy (socket fixe), Cloudflare et Telegram (configuration), et les cibles des routes — posées par un administrateur, le Hub ou un service raccordé ; un service ne peut viser ni la boucle locale, ni une adresse non spécifiée ou de lien local, ni leurs écritures non canoniques (`src/relais.js:43`) ; la sonde d’une cible ne suit aucune redirection et ne rend que le code HTTP à qui gère les routes | essais `test/relay.test.js:402`, `test/relay.test.js:594` ; sondage exploratoire (P7 à P9) ; servir une cible du réseau privé est la fonction d’un relais : la machine et le réseau restent permis à l’administrateur |
| SEC-CSRF-005 | HIGH | PASS | webhooks sortants : Telegram (alertes et réponses au seul chat lié, `src/telegram.js:96`) ; aucun webhook reçu : le bot lit ses messages par `getUpdates` | essai `test/relay.test.js:368` |
| SEC-CSRF-006 | MEDIUM | N/A | aucune redirection pilotée par paramètre : voir SEC-XSS-007 |  |
| SEC-API-001 | HIGH | PASS | voir REQ-WEB-006 |  |
| SEC-API-002 | HIGH | PASS | voir REQ-WEB-008 ; échecs du jeton du Hub plafonnés par adresse (voir REQ-AUTH-010) |  |
| SEC-API-003 | MEDIUM | PASS | listes bornées par construction : 500 routes, 100 services (`src/base.js:19`) ; aucun paramètre de taille accepté |  |
| SEC-API-004 | HIGH | PASS | réponses construites champ par champ : routes (`src/base.js:108`), services sans empreinte (`src/base.js:135`), réglages publics sans secret, configuration sans le jeton Cloudflare | sondage exploratoire ci-dessous |
| SEC-API-005 | MEDIUM | PASS | 405 avec Allow : `src/api.js:433` ; aucune page de documentation ni de débogage |  |
| SEC-API-006 | HIGH | N/A | aucun GraphQL : `grep -rniwE "graphql\|apollo" src web socle/src socle/web/compte.js` → 0 |  |
| SEC-API-007 | MEDIUM | PASS | un seul formateur d’erreurs : `socle/src/http.js:159` ; refus de Caddy ou de Cloudflare en 502 avec leur message ; rescellage des jetons après une rotation en une seule transaction (`src/base.js:65`) ; reprise d’une 1.x en une transaction, ou rien |  |
| SEC-API-008 | MEDIUM | N/A | aucune opération monétaire ni crédit : `grep -rniwE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web socle/src socle/web/compte.js` → 0 |  |
| SEC-API-009 | HIGH | PASS | pas de RPC implicite ; chaque geste est une route nommée avec son schéma |  |
| SEC-API-010 | MEDIUM | PASS | `socle/src/http.js:128` ; 32 Kio pour tout corps (`src/api.js:99`) | sondage exploratoire ci-dessous (« corps géant annoncé ») |
| SEC-DB-001 | CRITICAL | PASS | voir REQ-DATA-001 |  |
| SEC-DB-002 | HIGH | N/A | SQLite embarqué sans rôle ni identifiant : `src/base.js:27` |  |
| SEC-DB-003 | HIGH | FAIL | aucun trafic réseau vers la base ; secrets de facteurs et jetons des réglages chiffrés | chiffrement du disque des hôtes : action H7 |
| SEC-DB-004 | MEDIUM | PASS | secrets TOTP et jetons des réglages scellés AES-256-GCM, sous-clé par usage (`src/base.js:98`) ; clé maîtresse jamais dans le volume : secret du Hub, ou secret Docker hors du volume pour l’installation seule (`docker-compose.yml:66`) | essai `test/relay.test.js:628` (base restaurée lue en brut : secrets toujours scellés) ; sondage exploratoire (« secret au repos ») |
| SEC-DB-005 | CRITICAL | PASS | voir SEC-INJ-001 |  |
| SEC-DB-006 | HIGH | FAIL | voir REQ-DATA-003 | action H8 |
| SEC-DB-007 | MEDIUM | PASS | essais sur données fabriquées ; aucun compte par défaut : jeton d’installation exigé (`socle/src/comptes.js:249`) |  |
| SEC-DB-008 | CRITICAL | N/A | le navigateur ne parle jamais à la base : SQLite côté serveur seulement |  |
| SEC-DB-009 | LOW | PASS | `src/base.js:28` ; listes plafonnées | un seul processus, la ligne de commande en second écrivain (WAL) |
| SEC-DB-010 | LOW | PASS | voir REQ-DATA-004 : routes, services, réglages, sauvegardes et secrets retirés au journal chaîné |  |
| SEC-FILE-001 | HIGH | N/A | aucun envoi de fichier : corps JSON seulement (`socle/src/http.js:122`) |  |
| SEC-FILE-002 | MEDIUM | N/A | aucun envoi de fichier ; corps JSON bornés (voir SEC-API-010) |  |
| SEC-FILE-003 | HIGH | N/A | aucun fichier d’utilisateur écrit ; seules écritures : la base et le fichier des noms locaux, au nom fixe (`src/relais.js:79`) |  |
| SEC-FILE-004 | HIGH | N/A | aucun fichier d’utilisateur servi ; le certificat racine de Caddy est produit par Caddy, en pièce jointe (`src/api.js:184`) |  |
| SEC-FILE-005 | CRITICAL | N/A | aucun fichier d’utilisateur stocké |  |
| SEC-FILE-006 | MEDIUM | N/A | aucun fichier partagé entre utilisateurs |  |
| SEC-FILE-007 | LOW | N/A | aucune image acceptée |  |
| SEC-FILE-008 | HIGH | N/A | aucun import par adresse fournie par un utilisateur : Relay ne télécharge rien d’une adresse saisie ; la sonde d’une cible lit un code HTTP et jette le corps (`src/relais.js:201`) |  |
| SEC-PAY-001 | CRITICAL | N/A | `grep -rniwE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web socle/src socle/web/compte.js` → 0 : aucun paiement |  |
| SEC-PAY-002 | CRITICAL | N/A | `grep -rniwE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web socle/src socle/web/compte.js` → 0 : aucun paiement |  |
| SEC-PAY-003 | HIGH | N/A | `grep -rniwE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web socle/src socle/web/compte.js` → 0 : aucun paiement |  |
| SEC-PAY-004 | HIGH | N/A | `grep -rniwE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web socle/src socle/web/compte.js` → 0 : aucun paiement |  |
| SEC-PAY-005 | HIGH | N/A | `grep -rniwE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web socle/src socle/web/compte.js` → 0 : aucun paiement |  |
| SEC-PAY-006 | HIGH | PASS | vérification : 5 par heure par compte et par adresse (`socle/src/portail.js:38`) ; alertes : 30 par heure et par compte (`socle/src/notifications.js:98`) | destinataires et contenus jamais choisis par une requête |
| SEC-PAY-007 | MEDIUM | FAIL | le domaine d’expédition est celui du relais de l’exploitant | SPF, DKIM et DMARC à publier avec le relais : action H2 |
| SEC-PAY-008 | MEDIUM | PASS | aucun mot de passe dans un courriel ; liens uniques, hachés, de 30 minutes (`socle/src/comptes.js:38`) ou 72 heures pour fermer les sessions (`socle/src/notifications.js:27`) | le lien de révocation ne peut que fermer des sessions |
| SEC-NEXT-001 | CRITICAL | N/A | Node sans cadriciel, aucune dépendance (`package.json:9`, sans `dependencies`) ; `grep -rniwE "next/\|nextjs\|use server\|vercel" src web socle/src socle/web/compte.js` → 0 |  |
| SEC-NEXT-002 | CRITICAL | N/A | Node sans cadriciel, aucune dépendance (`package.json:9`, sans `dependencies`) ; `grep -rniwE "next/\|nextjs\|use server\|vercel" src web socle/src socle/web/compte.js` → 0 |  |
| SEC-NEXT-003 | HIGH | N/A | Node sans cadriciel, aucune dépendance (`package.json:9`, sans `dependencies`) ; `grep -rniwE "next/\|nextjs\|use server\|vercel" src web socle/src socle/web/compte.js` → 0 |  |
| SEC-NEXT-004 | CRITICAL | N/A | Node sans cadriciel, aucune dépendance (`package.json:9`, sans `dependencies`) ; `grep -rniwE "next/\|nextjs\|use server\|vercel" src web socle/src socle/web/compte.js` → 0 |  |
| SEC-NEXT-005 | HIGH | N/A | Node sans cadriciel, aucune dépendance (`package.json:9`, sans `dependencies`) ; `grep -rniwE "next/\|nextjs\|use server\|vercel" src web socle/src socle/web/compte.js` → 0 |  |
| SEC-NEXT-006 | HIGH | N/A | Node sans cadriciel, aucune dépendance (`package.json:9`, sans `dependencies`) ; `grep -rniwE "next/\|nextjs\|use server\|vercel" src web socle/src socle/web/compte.js` → 0 |  |
| SEC-NEXT-007 | HIGH | N/A | Node sans cadriciel, aucune dépendance (`package.json:9`, sans `dependencies`) ; `grep -rniwE "next/\|nextjs\|use server\|vercel" src web socle/src socle/web/compte.js` → 0 |  |
| SEC-NEXT-008 | MEDIUM | N/A | Node sans cadriciel, aucune dépendance (`package.json:9`, sans `dependencies`) ; `grep -rniwE "next/\|nextjs\|use server\|vercel" src web socle/src socle/web/compte.js` → 0 |  |
| SEC-NEXT-009 | MEDIUM | N/A | Node sans cadriciel, aucune dépendance (`package.json:9`, sans `dependencies`) ; `grep -rniwE "next/\|nextjs\|use server\|vercel" src web socle/src socle/web/compte.js` → 0 |  |
| SEC-BAAS-001 | CRITICAL | N/A | `grep -rniwE "supabase\|firebase\|firestore\|postgrest" src web socle/src socle/web/compte.js` → 0 ; base SQLite embarquée côté serveur : `src/base.js:27` |  |
| SEC-BAAS-002 | CRITICAL | N/A | `grep -rniwE "supabase\|firebase\|firestore\|postgrest" src web socle/src socle/web/compte.js` → 0 ; base SQLite embarquée côté serveur : `src/base.js:27` |  |
| SEC-BAAS-003 | CRITICAL | N/A | `grep -rniwE "supabase\|firebase\|firestore\|postgrest" src web socle/src socle/web/compte.js` → 0 ; base SQLite embarquée côté serveur : `src/base.js:27` |  |
| SEC-BAAS-004 | HIGH | N/A | `grep -rniwE "supabase\|firebase\|firestore\|postgrest" src web socle/src socle/web/compte.js` → 0 ; base SQLite embarquée côté serveur : `src/base.js:27` |  |
| SEC-BAAS-005 | CRITICAL | N/A | `grep -rniwE "supabase\|firebase\|firestore\|postgrest" src web socle/src socle/web/compte.js` → 0 ; base SQLite embarquée côté serveur : `src/base.js:27` |  |
| SEC-BAAS-006 | HIGH | N/A | `grep -rniwE "supabase\|firebase\|firestore\|postgrest" src web socle/src socle/web/compte.js` → 0 ; base SQLite embarquée côté serveur : `src/base.js:27` |  |
| SEC-BAAS-007 | MEDIUM | N/A | `grep -rniwE "supabase\|firebase\|firestore\|postgrest" src web socle/src socle/web/compte.js` → 0 ; base SQLite embarquée côté serveur : `src/base.js:27` |  |
| SEC-BAAS-008 | CRITICAL | N/A | `grep -rniwE "supabase\|firebase\|firestore\|postgrest" src web socle/src socle/web/compte.js` → 0 ; base SQLite embarquée côté serveur : `src/base.js:27` |  |
| SEC-BAAS-009 | CRITICAL | N/A | `grep -rniwE "supabase\|firebase\|firestore\|postgrest" src web socle/src socle/web/compte.js` → 0 ; base SQLite embarquée côté serveur : `src/base.js:27` |  |
| SEC-BAAS-010 | HIGH | N/A | `grep -rniwE "supabase\|firebase\|firestore\|postgrest" src web socle/src socle/web/compte.js` → 0 ; base SQLite embarquée côté serveur : `src/base.js:27` |  |
| SEC-BAAS-011 | HIGH | N/A | `grep -rniwE "supabase\|firebase\|firestore\|postgrest" src web socle/src socle/web/compte.js` → 0 ; base SQLite embarquée côté serveur : `src/base.js:27` |  |
| SEC-BE-001 | MEDIUM | PASS | en-têtes posés avant toute route, erreurs et 429 compris : `src/main.js:75` | annexe B.4 |
| SEC-BE-002 | MEDIUM | PASS | corps bornés ; 404 pour l’inconnu ; relais de confiance explicites : `socle/src/http.js:14` ; délais du serveur : `src/main.js:86` ; délais de Caddy, Cloudflare, Telegram et des sondes bornés | formateur d’erreurs unique : `src/main.js:83` |
| SEC-BE-003 | HIGH | PASS | voir SEC-INJ-004 et SEC-INJ-008 ; aucun import dynamique d’un chemin fourni | modules du navigateur importés depuis des chemins fixes |
| SEC-BE-004 | HIGH | PASS | aucune dépendance npm, contrôlé en CI (`.github/workflows/verification.yml:38`) : rien à verrouiller | Playwright ne sert qu’à l’outil de parcours, hors de l’image et du dépôt |
| SEC-BE-005 | CRITICAL | N/A | aucun Django : serveur Node seul, aucun Python dans le dépôt (`git ls-files "*.py" \| wc -l` → 0) |  |
| SEC-BE-006 | HIGH | N/A | aucun Flask ni FastAPI : serveur Node seul, aucun Python dans le dépôt (`git ls-files "*.py" \| wc -l` → 0) |  |
| SEC-BE-007 | HIGH | N/A | aucun Python dans le dépôt : voir SEC-BE-006 |  |
| SEC-BE-008 | HIGH | N/A | aucun PHP : `git ls-files "*.php" \| wc -l` → 0 |  |
| SEC-BE-009 | MEDIUM | PASS | Relay sans root (`Dockerfile:69`), Caddy seul sur une image vide, sans root ni capacité (`Dockerfile:43`), dnsmasq sans root (`Dockerfile:56`) ; conteneurs en lecture seule, sans capacité, sans nouveaux privilèges ; dossier de données en 0700, base et fichiers WAL en 0600 |  |
| SEC-BE-010 | MEDIUM | PASS | `socle/src/http.js:159` ; santé publique réduite à « vivant » : `src/api.js:127` | sondage exploratoire (« erreur interne détaillée ») |
| SEC-WP-001 | CRITICAL | N/A | application Node écrite ici : `grep -rniwE "wordpress\|wp-admin\|bubble\|webflow\|airtable" src web socle/src socle/web/compte.js` → 0 |  |
| SEC-WP-002 | HIGH | N/A | application Node écrite ici : `grep -rniwE "wordpress\|wp-admin\|bubble\|webflow\|airtable" src web socle/src socle/web/compte.js` → 0 |  |
| SEC-WP-003 | HIGH | N/A | application Node écrite ici : `grep -rniwE "wordpress\|wp-admin\|bubble\|webflow\|airtable" src web socle/src socle/web/compte.js` → 0 |  |
| SEC-WP-004 | MEDIUM | N/A | application Node écrite ici : `grep -rniwE "wordpress\|wp-admin\|bubble\|webflow\|airtable" src web socle/src socle/web/compte.js` → 0 |  |
| SEC-WP-005 | MEDIUM | N/A | application Node écrite ici : `grep -rniwE "wordpress\|wp-admin\|bubble\|webflow\|airtable" src web socle/src socle/web/compte.js` → 0 |  |
| SEC-WP-006 | CRITICAL | N/A | application Node écrite ici : `grep -rniwE "wordpress\|wp-admin\|bubble\|webflow\|airtable" src web socle/src socle/web/compte.js` → 0 |  |
| SEC-WP-007 | HIGH | N/A | application Node écrite ici : `grep -rniwE "wordpress\|wp-admin\|bubble\|webflow\|airtable" src web socle/src socle/web/compte.js` → 0 |  |
| SEC-WP-008 | MEDIUM | N/A | application Node écrite ici : `grep -rniwE "wordpress\|wp-admin\|bubble\|webflow\|airtable" src web socle/src socle/web/compte.js` → 0 |  |
| SEC-INFRA-001 | HIGH | FAIL | voir REQ-WEB-001 | action H1 |
| SEC-INFRA-002 | MEDIUM | FAIL | aucun domaine dans le dépôt ; Relay ne laisse pas d’enregistrement orphelin : il retire l’enregistrement A et le CNAME qu’il a écrits avec la route (`src/cloudflare.js:98`), ne touche jamais ceux d’un autre, et dit l’échec en avertissement | CAA, DNSSEC, verrou du registraire et 2FA des domaines servis : action H13 |
| SEC-INFRA-003 | HIGH | FAIL | hôtes de l’exploitant ; le résolveur n’écoute que sur l’adresse de la machine (`deploy/compose.hub.yml:52`) | pare-feu, SSH par clé, mises à jour ; ports 80 et 443 ouverts depuis Internet seulement si une route publique l’exige : action H9 |
| SEC-INFRA-004 | MEDIUM | FAIL | image Node et image de construction de Caddy par empreinte (`Dockerfile:11`, `Dockerfile:13`) ; trois conteneurs sans root, en lecture seule, sans capacité, bornés en mémoire, processeur et processus (`deploy/compose.hub.yml:31`, `docker-compose.yml:75`) ; API d’administration de Caddy sur un socket, sans port, et sans configuration sur disque (`src/caddy.js:55`) ; installé seul : interface publiée sur la boucle locale (`docker-compose.yml:57`) | crible des trois images (Grype en CI, Trivy au déploiement) à exécuter : actions H3, H14 |
| SEC-INFRA-005 | CRITICAL | N/A | aucun stockage objet : `grep -rniwE "s3\|gcs\|azure\|bucket" src socle/src` → 0 |  |
| SEC-INFRA-006 | HIGH | N/A | déploiement auto-hébergé, aucune identité de nuage ni clé IAM ; le jeton d’API Cloudflare est une clé de fournisseur, traitée par SEC-SECRETS-005 (portée, environnement : action H6) |  |
| SEC-INFRA-007 | HIGH | FAIL | permissions minimales, actions épinglées par commit, aucun secret pour les demandes de fusion | protection de branche et revue requise : action H3 |
| SEC-INFRA-008 | MEDIUM | FAIL | images construites sur la machine qui les sert (GitHub Packages n’est pas utilisé) ; chaque image passée au crible en CI (`.github/workflows/verification.yml:64`) | empreinte et SBOM relevés au déploiement : actions H3, H14 |
| SEC-INFRA-009 | MEDIUM | N/A | aucune infrastructure décrite en code : `find . -name "*.tf" -o -name "Pulumi.yaml"` → 0 fichier |  |
| SEC-DEP-001 | HIGH | PASS | aucune dépendance npm ; image Node et image de construction de Caddy par empreinte (`Dockerfile:11`, `Dockerfile:13`) ; module DNS Cloudflare à sa version (`Dockerfile:22`) ; actions par commit ; modules Go contrôlés par go.sum et la base de sommes publique (`Dockerfile:28`) | empreinte et version relevées sur la VM le 2026-10-20 (construction des images de la 2.3.0) |
| SEC-DEP-002 | HIGH | FAIL | aucune dépendance npm ; trois images passées au crible à chaque vérification (`.github/workflows/verification.yml:64`) | alertes Dependabot et contrôle requis : action H3 |
| SEC-DEP-003 | MEDIUM | PASS | aucune dépendance npm ni bibliothèque du navigateur : interface, gabarit et QR code écrits ici (`socle/web/qr.js:1`) |  |
| SEC-DEP-004 | MEDIUM | PASS | actions épinglées par commit (`.github/workflows/verification.yml:23`) ; image Node par empreinte ; mises à jour proposées en demandes de fusion, jamais fusionnées seules (`.github/dependabot.yml:6`) | revue requise avant fusion : protection de branche, action H3 |
| SEC-DEP-005 | MEDIUM | PASS | aucune installation de paquet npm : ni npm install ni script de cycle de vie, dans le dépôt comme dans l’image (`Dockerfile:65` sans installation) | paquets système de l’image (tini, dnsmasq) depuis les dépôts Alpine de l’image épinglée |
| SEC-DEP-006 | LOW | FAIL | SBOM non produit : aucune publication depuis la CI | à relever au déploiement (`docker buildx build --sbom=true` ou Syft sur la VM) : action H14 |
| SEC-DEP-007 | MEDIUM | PASS | voir SEC-XSS-008 |  |
| SEC-DEP-008 | LOW | FAIL | trois images au crible à chaque vérification | abonnement aux avis GitHub : action H3 |
| SEC-LLM-001 | CRITICAL | N/A | `grep -rniwE "openai\|anthropic\|ollama\|llm\|gpt\|claude\|mistral\|moonshot" src web` → 0 : Relay n’appelle aucun modèle |  |
| SEC-LLM-002 | CRITICAL | N/A | `grep -rniwE "openai\|anthropic\|ollama\|llm\|gpt\|claude\|mistral\|moonshot" src web` → 0 : Relay n’appelle aucun modèle |  |
| SEC-LLM-003 | HIGH | N/A | `grep -rniwE "openai\|anthropic\|ollama\|llm\|gpt\|claude\|mistral\|moonshot" src web` → 0 : Relay n’appelle aucun modèle |  |
| SEC-LLM-004 | HIGH | N/A | `grep -rniwE "openai\|anthropic\|ollama\|llm\|gpt\|claude\|mistral\|moonshot" src web` → 0 : Relay n’appelle aucun modèle |  |
| SEC-LLM-005 | CRITICAL | N/A | `grep -rniwE "openai\|anthropic\|ollama\|llm\|gpt\|claude\|mistral\|moonshot" src web` → 0 : Relay n’appelle aucun modèle |  |
| SEC-LLM-006 | HIGH | N/A | `grep -rniwE "openai\|anthropic\|ollama\|llm\|gpt\|claude\|mistral\|moonshot" src web` → 0 : Relay n’appelle aucun modèle |  |
| SEC-LLM-007 | MEDIUM | N/A | `grep -rniwE "openai\|anthropic\|ollama\|llm\|gpt\|claude\|mistral\|moonshot" src web` → 0 : Relay n’appelle aucun modèle |  |
| SEC-LLM-008 | LOW | N/A | `grep -rniwE "openai\|anthropic\|ollama\|llm\|gpt\|claude\|mistral\|moonshot" src web` → 0 : Relay n’appelle aucun modèle |  |
| SEC-LOG-001 | MEDIUM | PASS | voir REQ-DATA-004 ; chaque ligne : date, acteur, adresse, action, objet, résultat (`socle/src/journal.js:10`) ; identifiant de requête : `socle/src/requete.js:12` | magasin persistant : le journal chaîné en base ; hors hôte : action H11 |
| SEC-LOG-002 | HIGH | PASS | `socle/src/journal.js:10` ; jamais un jeton ni une clé au journal : les réglages journalisés disent si un jeton a changé, jamais lequel (`src/api.js:316`) |  |
| SEC-LOG-003 | MEDIUM | FAIL | sortie standard conservée par Docker, hors de portée du service, bornée (`deploy/compose.hub.yml:37`, `docker-compose.yml:27`) | collecteur central hors hôte : action H11 |
| SEC-LOG-004 | MEDIUM | FAIL | règles du socle : rafales d’échecs de connexion, jetons refusés compris, refus d’accès, verrous et limites, erreurs internes (`socle/src/vigie.js:11`) ; Relay : cible en panne et reprise, Caddy qui refuse une configuration, noms locaux non écrits, signalés une fois par Telegram (`src/relais.js:92`) | essai `test/relay.test.js:694` ; alertes de sécurité hors de l’application par courriel : action H2 |
| SEC-LOG-005 | LOW | FAIL | santé du conteneur : `Dockerfile:73` ; sonde du Hub (`hub.json:362`) | surveillance externe : action H10 |
| SEC-LOG-006 | MEDIUM | PASS | runbook ci-dessous |  |
| SEC-LOG-007 | HIGH | PASS | sessions : fermeture globale `socle/src/portail.js:489` ; jetons des réglages retirés en ligne de commande, service en marche, Caddy suit (`src/cli.js:57`) ; jeton du Hub changé au redéploiement ; jeton d’un service tourné en un geste ; SOCLE_CLE tournée sans réinscription ; chaque procédure écrite dans le runbook ci-dessous | joué de bout en bout : `outils/exercice-incident.mjs` (28 vérifications, joué le 2026-10-20 et par `test/incident.test.js:9`) |
| SEC-PRIV-001 | MEDIUM | PASS | `web/confidentialite.txt:7` avec durées ; purges automatiques du socle : `socle/src/comptes.js:1062` |  |
| SEC-PRIV-002 | MEDIUM | PASS | un cookie de session indispensable, documenté ; aucun traceur (`web/confidentialite.txt:71`) |  |
| SEC-PRIV-003 | MEDIUM | PASS | `web/confidentialite.txt:56` nomme chaque destinataire (Let’s Encrypt, Cloudflare, Telegram, le Hub, le relais SMTP) et ce qu’il reçoit ; lien depuis la page Sécurité (`web/app.js:44`) |  |
| SEC-PRIV-004 | MEDIUM | PASS | export : `socle/src/portail.js:343` ; effacement en libre-service sous renfort : `socle/src/comptes.js:932` ; Relay ne garde rien d’un compte hors des tables du socle (une route posée à la main n’a pas de propriétaire nominatif) |  |
| SEC-PRIV-005 | HIGH | FAIL | voir REQ-DATA-002 | action H7 |
| SEC-PRIV-006 | LOW | FAIL | sous-traitants possibles, tous choisis par l’exploitant : Cloudflare, Telegram, Let’s Encrypt, relais SMTP | accord de traitement ou fournisseur européen : action H15 |
| SEC-PRIV-007 | MEDIUM | PASS | runbook : notification sous 72 heures |  |
| SEC-PRIV-008 | LOW | PASS | `web/confidentialite.txt:93` | aucune catégorie particulière de données |
| SEC-TEST-001 | MEDIUM | FAIL | `.github/workflows/verification.yml:143` | Actions : H3 |
| SEC-TEST-002 | HIGH | FAIL | voir REQ-CI-001 | actions H3, H4 |
| SEC-TEST-003 | HIGH | FAIL | trois images : `.github/workflows/verification.yml:64` | actions H3, H14 |
| SEC-TEST-004 | MEDIUM | FAIL | aucun passage DAST encore | ZAP en mode « baseline » contre la VM d’essai : action H14 |
| SEC-TEST-005 | LOW | FAIL | voir REQ-WEB-001 | notation après HTTPS : action H1 |
| SEC-TEST-006 | HIGH | PASS | voir REQ-CI-006 |  |
| SEC-TEST-007 | LOW | PASS | sondage exploratoire du 2026-10-20 (32 cas), rejoué à chaque génération de ce fichier : section « Exploratory probing » ci-dessous (portées des jetons, nom d’un autre, cibles interdites, injection dans la configuration de Caddy, en-tête Host, champs et paramètres inconnus, corps géants, jetons inventés) | chaque trouvaille de cet audit est devenue un essai de non-régression (voir « Findings ») |
| SEC-TEST-008 | LOW | N/A | ni argent, ni santé, ni large public : service auto-hébergé pour quelques comptes invités ; `grep -rniwE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web socle/src socle/web/compte.js` → 0 |  |

## Not applicable
| ID | Why, with proof |
|---|---|
| REQ-DATA-007 | aucun envoi de fichier ni import depuis une adresse fournie par un utilisateur : corps JSON seulement (`socle/src/http.js:122`), `grep -rniwE "multipart\|busboy\|formidable" src socle/src` → 0 ; la reprise d’une 1.x lit un dossier monté par l’exploitant, contrôlé comme une saisie |
| SEC-AUTHZ-005 | aucune notion de locataire : une instance sert les noms d’un réseau ; `grep -rniwE "tenants?\|organisations?\|workspaces?" src` → 0 |
| SEC-INJ-007 | aucun analyseur XML côté serveur : `grep -rniwE "xml2js\|sax\|libxml\|fast-xml\|DOMParser" src socle/src` → 0 |
| SEC-XSS-002 | aucun texte riche ni Markdown rendu : noms, cibles et messages affichés en texte brut (voir SEC-XSS-001) |
| SEC-API-006 | aucun GraphQL : `grep -rniwE "graphql\|apollo" src web socle/src socle/web/compte.js` → 0 |
| SEC-API-008 | aucune opération monétaire ni crédit : `grep -rniwE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web socle/src socle/web/compte.js` → 0 |
| SEC-DB-002 | SQLite embarqué sans rôle ni identifiant : `src/base.js:27` |
| SEC-FILE-003 | aucun fichier d’utilisateur écrit ; seules écritures : la base et le fichier des noms locaux, au nom fixe (`src/relais.js:79`) |
| SEC-FILE-004 | aucun fichier d’utilisateur servi ; le certificat racine de Caddy est produit par Caddy, en pièce jointe (`src/api.js:184`) |
| SEC-FILE-008 | aucun import par adresse fournie par un utilisateur : Relay ne télécharge rien d’une adresse saisie ; la sonde d’une cible lit un code HTTP et jette le corps (`src/relais.js:201`) |
| SEC-PAY-001 | `grep -rniwE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web socle/src socle/web/compte.js` → 0 : aucun paiement |
| SEC-PAY-002 | `grep -rniwE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web socle/src socle/web/compte.js` → 0 : aucun paiement |
| SEC-PAY-003 | `grep -rniwE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web socle/src socle/web/compte.js` → 0 : aucun paiement |
| SEC-PAY-004 | `grep -rniwE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web socle/src socle/web/compte.js` → 0 : aucun paiement |
| SEC-PAY-005 | `grep -rniwE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web socle/src socle/web/compte.js` → 0 : aucun paiement |
| SEC-NEXT-001 | Node sans cadriciel, aucune dépendance (`package.json:9`, sans `dependencies`) ; `grep -rniwE "next/\|nextjs\|use server\|vercel" src web socle/src socle/web/compte.js` → 0 |
| SEC-NEXT-002 | Node sans cadriciel, aucune dépendance (`package.json:9`, sans `dependencies`) ; `grep -rniwE "next/\|nextjs\|use server\|vercel" src web socle/src socle/web/compte.js` → 0 |
| SEC-NEXT-003 | Node sans cadriciel, aucune dépendance (`package.json:9`, sans `dependencies`) ; `grep -rniwE "next/\|nextjs\|use server\|vercel" src web socle/src socle/web/compte.js` → 0 |
| SEC-NEXT-004 | Node sans cadriciel, aucune dépendance (`package.json:9`, sans `dependencies`) ; `grep -rniwE "next/\|nextjs\|use server\|vercel" src web socle/src socle/web/compte.js` → 0 |
| SEC-NEXT-005 | Node sans cadriciel, aucune dépendance (`package.json:9`, sans `dependencies`) ; `grep -rniwE "next/\|nextjs\|use server\|vercel" src web socle/src socle/web/compte.js` → 0 |
| SEC-NEXT-006 | Node sans cadriciel, aucune dépendance (`package.json:9`, sans `dependencies`) ; `grep -rniwE "next/\|nextjs\|use server\|vercel" src web socle/src socle/web/compte.js` → 0 |
| SEC-NEXT-007 | Node sans cadriciel, aucune dépendance (`package.json:9`, sans `dependencies`) ; `grep -rniwE "next/\|nextjs\|use server\|vercel" src web socle/src socle/web/compte.js` → 0 |
| SEC-NEXT-008 | Node sans cadriciel, aucune dépendance (`package.json:9`, sans `dependencies`) ; `grep -rniwE "next/\|nextjs\|use server\|vercel" src web socle/src socle/web/compte.js` → 0 |
| SEC-NEXT-009 | Node sans cadriciel, aucune dépendance (`package.json:9`, sans `dependencies`) ; `grep -rniwE "next/\|nextjs\|use server\|vercel" src web socle/src socle/web/compte.js` → 0 |
| SEC-BAAS-001 | `grep -rniwE "supabase\|firebase\|firestore\|postgrest" src web socle/src socle/web/compte.js` → 0 ; base SQLite embarquée côté serveur : `src/base.js:27` |
| SEC-BAAS-002 | `grep -rniwE "supabase\|firebase\|firestore\|postgrest" src web socle/src socle/web/compte.js` → 0 ; base SQLite embarquée côté serveur : `src/base.js:27` |
| SEC-BAAS-003 | `grep -rniwE "supabase\|firebase\|firestore\|postgrest" src web socle/src socle/web/compte.js` → 0 ; base SQLite embarquée côté serveur : `src/base.js:27` |
| SEC-BAAS-004 | `grep -rniwE "supabase\|firebase\|firestore\|postgrest" src web socle/src socle/web/compte.js` → 0 ; base SQLite embarquée côté serveur : `src/base.js:27` |
| SEC-BAAS-005 | `grep -rniwE "supabase\|firebase\|firestore\|postgrest" src web socle/src socle/web/compte.js` → 0 ; base SQLite embarquée côté serveur : `src/base.js:27` |
| SEC-BAAS-006 | `grep -rniwE "supabase\|firebase\|firestore\|postgrest" src web socle/src socle/web/compte.js` → 0 ; base SQLite embarquée côté serveur : `src/base.js:27` |
| SEC-BAAS-007 | `grep -rniwE "supabase\|firebase\|firestore\|postgrest" src web socle/src socle/web/compte.js` → 0 ; base SQLite embarquée côté serveur : `src/base.js:27` |
| SEC-BAAS-008 | `grep -rniwE "supabase\|firebase\|firestore\|postgrest" src web socle/src socle/web/compte.js` → 0 ; base SQLite embarquée côté serveur : `src/base.js:27` |
| SEC-BAAS-009 | `grep -rniwE "supabase\|firebase\|firestore\|postgrest" src web socle/src socle/web/compte.js` → 0 ; base SQLite embarquée côté serveur : `src/base.js:27` |
| SEC-BAAS-010 | `grep -rniwE "supabase\|firebase\|firestore\|postgrest" src web socle/src socle/web/compte.js` → 0 ; base SQLite embarquée côté serveur : `src/base.js:27` |
| SEC-BAAS-011 | `grep -rniwE "supabase\|firebase\|firestore\|postgrest" src web socle/src socle/web/compte.js` → 0 ; base SQLite embarquée côté serveur : `src/base.js:27` |
| SEC-BE-005 | aucun Django : serveur Node seul, aucun Python dans le dépôt (`git ls-files "*.py" \| wc -l` → 0) |
| SEC-BE-006 | aucun Flask ni FastAPI : serveur Node seul, aucun Python dans le dépôt (`git ls-files "*.py" \| wc -l` → 0) |
| SEC-BE-007 | aucun Python dans le dépôt : voir SEC-BE-006 |
| SEC-BE-008 | aucun PHP : `git ls-files "*.php" \| wc -l` → 0 |
| SEC-WP-001 | application Node écrite ici : `grep -rniwE "wordpress\|wp-admin\|bubble\|webflow\|airtable" src web socle/src socle/web/compte.js` → 0 |
| SEC-WP-002 | application Node écrite ici : `grep -rniwE "wordpress\|wp-admin\|bubble\|webflow\|airtable" src web socle/src socle/web/compte.js` → 0 |
| SEC-WP-003 | application Node écrite ici : `grep -rniwE "wordpress\|wp-admin\|bubble\|webflow\|airtable" src web socle/src socle/web/compte.js` → 0 |
| SEC-WP-004 | application Node écrite ici : `grep -rniwE "wordpress\|wp-admin\|bubble\|webflow\|airtable" src web socle/src socle/web/compte.js` → 0 |
| SEC-WP-005 | application Node écrite ici : `grep -rniwE "wordpress\|wp-admin\|bubble\|webflow\|airtable" src web socle/src socle/web/compte.js` → 0 |
| SEC-WP-006 | application Node écrite ici : `grep -rniwE "wordpress\|wp-admin\|bubble\|webflow\|airtable" src web socle/src socle/web/compte.js` → 0 |
| SEC-WP-007 | application Node écrite ici : `grep -rniwE "wordpress\|wp-admin\|bubble\|webflow\|airtable" src web socle/src socle/web/compte.js` → 0 |
| SEC-WP-008 | application Node écrite ici : `grep -rniwE "wordpress\|wp-admin\|bubble\|webflow\|airtable" src web socle/src socle/web/compte.js` → 0 |
| SEC-INFRA-005 | aucun stockage objet : `grep -rniwE "s3\|gcs\|azure\|bucket" src socle/src` → 0 |
| SEC-INFRA-006 | déploiement auto-hébergé, aucune identité de nuage ni clé IAM ; le jeton d’API Cloudflare est une clé de fournisseur, traitée par SEC-SECRETS-005 (portée, environnement : action H6) |
| SEC-LLM-001 | `grep -rniwE "openai\|anthropic\|ollama\|llm\|gpt\|claude\|mistral\|moonshot" src web` → 0 : Relay n’appelle aucun modèle |
| SEC-LLM-002 | `grep -rniwE "openai\|anthropic\|ollama\|llm\|gpt\|claude\|mistral\|moonshot" src web` → 0 : Relay n’appelle aucun modèle |
| SEC-LLM-003 | `grep -rniwE "openai\|anthropic\|ollama\|llm\|gpt\|claude\|mistral\|moonshot" src web` → 0 : Relay n’appelle aucun modèle |
| SEC-LLM-004 | `grep -rniwE "openai\|anthropic\|ollama\|llm\|gpt\|claude\|mistral\|moonshot" src web` → 0 : Relay n’appelle aucun modèle |
| SEC-LLM-005 | `grep -rniwE "openai\|anthropic\|ollama\|llm\|gpt\|claude\|mistral\|moonshot" src web` → 0 : Relay n’appelle aucun modèle |
| SEC-LLM-006 | `grep -rniwE "openai\|anthropic\|ollama\|llm\|gpt\|claude\|mistral\|moonshot" src web` → 0 : Relay n’appelle aucun modèle |
| SEC-LLM-007 | `grep -rniwE "openai\|anthropic\|ollama\|llm\|gpt\|claude\|mistral\|moonshot" src web` → 0 : Relay n’appelle aucun modèle |
| SEC-LLM-008 | `grep -rniwE "openai\|anthropic\|ollama\|llm\|gpt\|claude\|mistral\|moonshot" src web` → 0 : Relay n’appelle aucun modèle |
| SEC-TEST-008 | ni argent, ni santé, ni large public : service auto-hébergé pour quelques comptes invités ; `grep -rniwE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web socle/src socle/web/compte.js` → 0 |

## Anonymity (REQ-ANON-001 to -010)
Arbre de travail : 0 occurrence de la liste d’anonymat commune, ce fichier et NO-VIBE.md compris ; les motifs de l’annexe B.1 n’y relèvent que le nom `.env.local` du `.gitignore` et la mention générique d’un nom en `.lan`. Historique local complet (63 commits, tous les arbres, tous les messages, auteurs et validateurs) : une seule identité, toute en UTC ; aucune mention d’outil ; aucun chemin de poste ; aucune adresse privée ; 0 terme de la liste. Les commits de cette passe, jamais publiés, ont été réécrits avant publication pour ne pas introduire de nom d’exemple d’installation personnelle. Exposition résiduelle, toute dans l’historique déjà publié (jusqu’à v2.2.0) : 7 lignes portant un terme d’installation personnelle selon le motif de l’annexe B.1, auxquelles s’ajoutent des noms et ports d’exemple d’équipement que ce motif ne nomme pas — retirés de l’arbre, pas de l’historique : action H12, détail dans le rapport hors dépôt. Aucun binaire image ni document dans tout l’historique. Le balayage est fait sur motifs et sur une liste finie : il ne prouve pas l’absence de ce que la liste ne nomme pas.

## Human actions required
Ce qu’aucun agent ne peut faire à la place de l’exploitant. Cette liste bloque la mise en production tant qu’elle n’est pas vide.

| # | Action | Contrôles | Étapes |
|---|---|---|---|
| H1 | Servir l’interface de Relay en HTTPS | REQ-WEB-001, SEC-HDR-001, SEC-INFRA-001, SEC-TEST-005, REQ-DATA-002 | Une route de Relay vers sa propre interface (mode local ou certificat Let’s Encrypt), ou le relais du Hub ; déclarer l’adresse de Caddy dans « Relais de confiance » (SOCLE_PROXYS) ; « Accès sans HTTPS » à Non ; vérifier `curl -sI https://<relay>/ \| grep -i strict-transport-security` ; noter le résultat de testssl.sh. |
| H2 | Relais SMTP et adresses d’alerte | REQ-AUTH-014, SEC-PAY-007, SEC-LOG-004 | Réglages avancés de Relay dans le Hub : relais, port, chiffrement, identifiants, expéditeur, adresse publique ; SPF, DKIM et DMARC du domaine d’expédition ; chaque administrateur ajoute puis confirme son adresse dans Sécurité → Alertes. |
| H3 | GitHub | REQ-CI-001…005, GOV-003, GOV-005, SEC-INFRA-007/008, SEC-TEST-001…003, SEC-DEP-002/008 | Activer les Actions ; Settings → Branches : protéger `main` (pas de poussée forcée, contrôles requis : essais, images, secrets, identite, anonymat, analyse) ; Code security : Dependabot alerts, secret scanning et push protection, private vulnerability reporting ; 2FA sur le compte GitHub, Cloudflare et chaque console de fournisseur. |
| H4 | Liste d’anonymat | REQ-ANON-003, REQ-CI-004, REQ-CI-001 | Sur le poste : gitleaks ; liste et crochet global `pre-commit` qui refuse un diff portant un terme ; sur GitHub : secret de dépôt `LISTE_ANONYMAT` (la liste commune) pour `relay`. Vérifier qu’un commit d’essai portant un terme est refusé par le crochet, puis par la vérification. |
| H5 | Brûler les jetons vus pendant le développement | SEC-SECRETS-006 | Révoquer chez @BotFather tout jeton de bot ayant servi en essai ; régénérer chez Cloudflare tout jeton d’API utilisé hors production ; dans le Hub, régénérer HUB_TOKEN et HUB_ADMIN_TOKEN de Relay, puis redéployer ; tourner le jeton de chaque service raccordé (Services raccordés → Tourner) ; tourner SOCLE_CLE une fois. |
| H6 | Jetons restreints, par environnement | REQ-CFG-003, SEC-SECRETS-005, GOV-004 | Un jeton d’API Cloudflare dédié à Relay, limité aux zones servies (Zone → Zone → Lire, Zone → DNS → Modifier, Compte → Cloudflare Tunnel → Modifier) ; un bot Telegram dédié ; un jeu de jetons pour la VM d’essai, un autre pour la production. |
| H7 | Chiffrement des disques | REQ-DATA-002, SEC-DB-003, SEC-PRIV-005 | LUKS (ou chiffrement du stockage de l’hôte) sous les volumes de Relay et de Caddy. |
| H8 | Sauvegardes et exercices | REQ-DATA-003, SEC-DB-006 | Paire RSA 3072 bits créée hors de la machine de Relay ; cron quotidien `docker exec -i <relay> node src/cli.js sauvegarde < relay-sauvegarde.pub > relay-$(date -u +%F).sauv` ; copie hors hôte, trente jours ; restauration réelle sur la VM d’essai une fois par trimestre, datée ici. |
| H9 | Hôtes | SEC-INFRA-003 | Pare-feu : 80 et 443 depuis Internet seulement si une route publique l’exige, 53 au seul réseau local ; SSH par clé sans root ; mises à jour de sécurité automatiques. |
| H10 | Disponibilité vue de l’extérieur | SEC-LOG-005 | Une sonde externe sur `/api/health` et sur un nom servi, ou décision écrite : relais de réseau local, sondes du Hub suffisantes. |
| H11 | Journaux centralisés | SEC-LOG-003 | Transférer les journaux des trois conteneurs (dont le journal de sécurité) vers un collecteur hors de l’hôte. |
| H12 | Historique publié | REQ-ANON-002 | L’historique publié de `relay` (jusqu’à v2.2.0) garde des noms et ports d’exemple d’installation personnelle (rapport hors dépôt). Choisir : le laisser ; ou recréer le dépôt depuis l’arbre propre ; ou réécrire et forcer la poussée, avec ses conséquences (clones et bifurcations gardent l’ancien). |
| H13 | Domaines | REQ-ANON-009, SEC-INFRA-002 | Pour chaque domaine servi : protection WHOIS, verrou du registraire, 2FA, enregistrement CAA (Let’s Encrypt seul), DNSSEC chez Cloudflare. |
| H14 | Crible au déploiement | SEC-INFRA-004, SEC-INFRA-008, SEC-TEST-003, SEC-TEST-004, SEC-DEP-006 | Sur la VM, après construction : `trivy image` sur `relay`, `relay-caddy` et `relay-dns` sans CRITICAL ni HIGH corrigeable ; empreintes des trois images notées ici ; SBOM (`trivy image --format cyclonedx`) ; `zap-baseline.py -t http://<vm>:<port>` ; résultats notés ici. |
| H15 | Sous-traitants hors UE | SEC-PRIV-006 | Cloudflare, Telegram et le relais SMTP s’ils sont retenus : accord de traitement accepté, ou choix d’un service européen ou auto-hébergé. |
| H16 | Clé maîtresse hors ligne | REQ-DATA-003, SEC-DB-006 | Garder une copie hors ligne de SOCLE_CLE, à part des sauvegardes de la base. |
| H19 | Passage à la 2.3 | — (mise en service) | Pousser la 2.3.1, construire les trois images sur la VM, puis dans le Hub Mettre à jour et Redéployer ; un service raccordé de portée « routes » qui réglait les domaines passe par le Hub ou l’interface ; installé seul : reprendre la clé du volume (README, « Relay seul »). |
| H20 | Vérifier les cibles TLS qui le peuvent | REQ-DATA-002 | Dans la liste des routes, chaque cible marquée « certificat non vérifié » qui porte un vrai certificat : Modifier → « Vérifier le certificat de la cible ». Les autres (certificat auto-signé) : décision écrite, sur le réseau local seulement. |

## Secrets inventory
| Secret | Where it lives | Scope | Rotation procedure | Last rotated |
|---|---|---|---|---|
| SOCLE_CLE (clé maîtresse) | coffre du Hub, ou `secrets/socle_cle` (installation seule), jamais dans le volume | scelle les secrets TOTP et les jetons Telegram et Cloudflare | l’actuelle dans SOCLE_CLE_ANCIENNE, une neuve dans SOCLE_CLE, redémarrer (Relay rescelle et le journalise), retirer l’ancienne ; exercée par le runbook | à la création |
| RELAY_HUB_TOKEN (HUB_TOKEN) | coffre du Hub, environnement du conteneur | routes, publication, domaines de base, Cloudflare | régénérer dans le Hub, redéployer : l’ancien cesse de valoir (runbook, étape 3) | à la création |
| SOCLE_JETON_ADMIN_HUB (HUB_ADMIN_TOKEN) | coffre du Hub | délégation des comptes au Hub (socle), rien dans l’API de Relay | régénérer dans le Hub, redéployer | à la création |
| Jetons des services raccordés (`svc_…`) | chez chaque service ; dans Relay, par empreinte SHA-256 | ses routes (« soi ») ou toutes les routes (« routes ») | Services raccordés → Tourner (renfort) : l’ancien cesse de valoir, les routes restent ; Révoquer emporte ses routes | — |
| Jeton du bot Telegram | base, scellé | alertes et commandes du chat lié | @BotFather → /revoke ; Réglages → Telegram (renfort) ; `node src/cli.js secrets retirer telegram` | — |
| Jeton d’API Cloudflare | base, scellé ; mémoire de Caddy (défi DNS) | zones, enregistrements, tunnel | Cloudflare → Mon profil → Jetons d’API → Roll ; Hub → Connexions ou Réglages → Cloudflare (renfort) ; `node src/cli.js secrets retirer cloudflare` (Caddy suit) | — |
| Jeton du connecteur du tunnel (TUNNEL_TOKEN) | coffre du Hub, environnement de cloudflared | faire tourner le tunnel | Cloudflare Zero Trust → Tunnels → Refresh token, puis le Hub le repose et redéploie | — |
| Identifiants SMTP (`SOCLE_SMTP_*`) | coffre du Hub | envoi des alertes de sécurité | chez le relais, puis dans le Hub | — |
| SOCLE_JETON_INSTALLATION | coffre du Hub, ou journaux du premier démarrage | premier compte seulement | sans effet une fois l’installation faite | à la création |

## Incident runbook
```bash
# 1. Détecter : Sécurité → Journal (refus, verrous, jetons refusés, routes créées et leurs cibles) ; Hub → Relay → Journaux
# 2. Fermer toutes les sessions sauf la sienne (administrateur, renfort)
curl -X POST https://<relay>/api/compte/admin/sessions/fermer-tout -b <cookie> -H 'X-CSRF: <jeton>' -H 'Origin: https://<relay>'
# 3. Couper les machines : régénérer HUB_TOKEN dans le Hub, Redéployer ; Services raccordés → Tourner (ou Révoquer) chaque jeton suspect
# 4. Retirer les jetons des réglages, service en marche (Caddy reçoit sa configuration sans le jeton Cloudflare),
#    puis les révoquer chez @BotFather et chez Cloudflare
docker exec <relay> node src/cli.js secrets retirer
# 5. Vérifier ce qui est exposé : Routes → chaque nom, sa cible et qui l'a posée ; retirer ce qui n'a pas lieu d'être
# 6. Forcer un nouveau mot de passe : Comptes → compte → Réinitialiser (lien à usage unique, 20 minutes)
# 7. Restaurer, depuis le poste qui garde la clé privée, puis remettre la base dans le volume
node src/cli.js restaurer relay-sauvegarde.pem relay.db < relay-AAAA-MM-JJ.sauv
docker stop <relay> && docker run --rm -v <volume>:/data -v "$PWD":/b busybox sh -c 'cp /b/relay.db /data/relay.db && rm -f /data/relay.db-wal /data/relay.db-shm && chown 10001:10001 /data/relay.db && chmod 600 /data/relay.db' && docker start <relay>
#    Base sauvegardée avant une rotation : poser la clé d'alors dans SOCLE_CLE_ANCIENNE avant de démarrer ; Caddy reçoit ses routes au premier tour
# 8. Vérifier la chaîne du journal : Sécurité → Journal (« chaîne intacte »)
```
Qui : l’exploitant de l’instance tient chaque étape ; révoquer chez Telegram et Cloudflare ; support.github.com pour le dépôt. Communiquer : prévenir les comptes concernés et les responsables des services publiés ; si des données personnelles ont pu être lues (comptes, journal), notifier l’autorité de contrôle sous 72 heures à compter de la découverte. Joué de bout en bout le 2026-10-20 et à chaque vérification : `outils/exercice-incident.mjs`, 28 vérifications.

## Inventory
Routes publiques : `GET /api/health` (vivant), `GET /.well-known/security.txt`, l’état et les cérémonies de connexion et d’installation du socle, les pages de l’interface (`web/`, `socle/web`) sous leur gamme ; contrat de la 1.x (`/api/whoami`, `/api/heartbeat`, `/api/register`), jeton de service exigé. Session ou jeton : 33 routes sous `/api/`, chacune avec son schéma (`src/api.js`) et balayée contre les tables des droits (`test/relay.test.js`).

Données : `relay.db` (comptes, sessions, journal chaîné du socle ; routes et leurs cibles ; services raccordés par empreinte ; réglages aux jetons scellés — sensibilité : opérationnelle, et personnelle pour les comptes), volume `/data` en 0700, base en 0600 ; fichier des noms locaux (lu par le résolveur) ; certificats de Caddy dans son volume ; configuration de Caddy en mémoire seulement.

Tiers : Caddy et son module DNS Cloudflare (compilés ici), dnsmasq, cloudflared (image officielle, version choisie dans le Hub) ; en option, chez des fournisseurs : Cloudflare (DNS, tunnel), Let’s Encrypt, Telegram, relais SMTP ; le Hub, qui installe et pilote Relay.

## Appendix B sweep
Relancé à chaque génération de ce fichier (bash, LC_ALL=C.UTF-8) contre une instance neuve, deux fois de suite, résultats identiques ; B.5 est dans NO-VIBE.md.

| # | Commande | Résultat | Justification |
|---|---|---|---|
| B.1.1 | `git log --all --format='%an <%ae>' \| sort -u` | `CodexX64 <CodexX64@users.noreply.github.com>` | le pseudonyme seul |
| B.1.2 | `git log --all --format='%cn <%ce>' \| sort -u` | `CodexX64 <CodexX64@users.noreply.github.com>` | le pseudonyme seul |
| B.1.3 | `git log --all --format='%B' \| rg -in 'co-authored-by\|generated (by\|with)\|assistant\|as an ai' \| wc -l` | `0` |  |
| B.1.4 | `find . -path ./node_modules -prune -o \( -name .ai -o -name .cursor -o -name .aider -o -name .continue -o -name .windsurfrules \) -print \| wc -l` | `0` |  |
| B.1.5 | `find . -path ./node_modules -prune -o -regextype posix-extended -regex '.*/(CLAUDE\|AGENTS?\|PROMPTS?\|GEMINI)\.md' -print \| wc -l` | `0` |  |
| B.1.6 | `git log --all --name-only --format= \| sort -u \| rg -i '(^\|/)(CLAUDE\|AGENTS?\|PROMPTS?\|GEMINI)\.md$\|copilot-instructions\|\.cursor\|\.aider' \| wc -l` | `0` |  |
| B.1.7 | `rg -n 'copilot-instructions' . -g '!SECURITY.md' -g '!NO-VIBE.md' \| wc -l` | `0` |  |
| B.1.8 | `git grep -nIiE '/Users/\|/home/[a-z]\|C:\\\\\\\\Users\|\.local\b\|\.lan\b\|10\.[0-9]+\.\|192\.168\.\|172\.(1[6-9]\|2[0-9]\|3[01])\.' -- . ':!SECURITY.md' ':!NO-VIBE.md'` | 3 lignes | le nom `.env.local` du `.gitignore` et la mention générique d’un nom en `.lan` (documentation, commentaire) ; aucune adresse ni chemin réel |
| B.1.9 | `git log --all -p -- . ':!SECURITY.md' ':!NO-VIBE.md'` filtré par le motif « infrastructure personnelle » de l’annexe B.1, compté | `7` | historique déjà publié (jusqu’à v2.2.0) : des noms d’exemple d’installation personnelle, retirés de l’arbre par `3bf0cc5` ; s’y ajoute le mot « cadenas » (une icône), faux positif ; aucun dans l’arbre ni dans les commits de cette passe → H12, détail hors dépôt |
| B.1.9b | `git log --all -p -- . ':!SECURITY.md' ':!NO-VIBE.md'` filtré par le motif « infrastructure personnelle » de l’annexe B.1, compté par terme | 2 termes | les mêmes lignes, par terme (termes gardés hors dépôt) |
| B.1.10 | `git log --all --format='%aI' \| rg -v '\+00:00' \| wc -l` | `0` |  |
| B.1.11 | `git log --all --format='%cI' \| rg -v '\+00:00' \| wc -l` | `0` |  |
| B.1.12 | `git grep` de tout l’historique (`$(git rev-list --all)`) avec le motif des chemins de poste et d’espaces de travail d’outils (gardé hors dépôt), lignes distinctes comptées | `0` |  |
| B.1.13 | `git log --all --name-only --format= \| sort -u \| rg -i '\.(png\|jpe?g\|pdf\|mp4\|gif\|webp\|ico)$' \| wc -l` | `0` |  |
| B.1.14 | `git log --all -p -- . ':!SECURITY.md' ':!NO-VIBE.md'` filtré par la liste d’anonymat (gardée hors dépôt), compté | `0` |  |
| B.1.15 | `git log --all --format='%B%n%an%n%ae%n%cn%n%ce'` filtré par la liste d’anonymat (gardée hors dépôt), compté | `0` |  |
| B.1.16 | `git grep -- . ':!SECURITY.md' ':!NO-VIBE.md' \| wc -l` filtré par la liste d’anonymat (gardée hors dépôt), compté | `0` |  |
| B.2.1 | `gitleaks git --no-banner --redact . 2>&1 \| tail -1 \| sed -E 's/^.*(no leaks found\|leaks found: [0-9]+).*$/\\1/'` | `no leaks found` | tout l’historique, toutes références |
| B.2.2 | `gitleaks dir --no-banner --redact . 2>&1 \| tail -1 \| sed -E 's/^.*(no leaks found\|leaks found: [0-9]+).*$/\\1/'` | `no leaks found` | arbre de travail |
| B.2.3 | `git grep -nIiE '(api[_-]?key\|secret\|token\|password\|bearer)\s*[=:]\s*[\"'\''][^\"'\'']{8,}' -- . ':!SECURITY.md' ':!NO-VIBE.md'` | 7 lignes | gabarits `{{config.…}}` du manifeste du Hub, jetons fabriqués des essais, de la vitrine et de l’exercice, le vecteur publié de la RFC 6238 dans un essai du socle, et le remplacement du jeton Cloudflare par « (scellé) » ; aucun secret réel |
| B.2.4 | `git grep -nI -e '-----BEGIN (RSA\|EC\|OPENSSH\|PGP) PRIVATE' -- . ':!SECURITY.md' ':!NO-VIBE.md' \| wc -l` | `0` |  |
| B.2.5 | `rg -ni 'sk_live\|service_role\|xox[baprs]-\|-----BEGIN' web socle/web \| wc -l` | `0` |  |
| B.2.x | `git log --all -p -- . ':!SECURITY.md' ':!NO-VIBE.md' \| rg -n 'sk-ant-\|sk_live_\|AKIA[0-9A-Z]{16}\|ghp_[A-Za-z0-9]{30}\|xox[bp]-\|-----BEGIN [A-Z]* ?PRIVATE' \| wc -l` | `0` |  |
| B.3.1 | `rg -n 'dangerouslySetInnerHTML\|innerHTML *=\|outerHTML *=\|document\.write' . -g '!SECURITY.md' -g '!NO-VIBE.md'` | 2 lignes | gabarit du socle : balisage écrit dans le code (pictogrammes), jamais une donnée |
| B.3.2 | `rg -n 'eval\(\|new Function\(\|execSync\|child_process\|os\.system\|subprocess.*shell=True' . -g '!SECURITY.md' -g '!NO-VIBE.md'` | 5 lignes | les essais, l’exercice du runbook et les outils d’essai du socle lancent des processus ; aucun processus lancé par `src/` |
| B.3.3 | `rg -n '[^.]\bexec\(' . -g '!SECURITY.md' -g '!NO-VIBE.md' \| wc -l` | `0` |  |
| B.3.4 | `rg -n 'f\"SELECT\|\"SELECT .*\" *\+\|\\$\{.*\} *FROM\|\.raw\(\|query\(.*\+ *req\.' . -g '!SECURITY.md' -g '!NO-VIBE.md' \| wc -l` | `0` |  |
| B.3.5 | `rg -n 'Math\.random\|uuidv1\|new Random\(\)' . -g '!SECURITY.md' -g '!NO-VIBE.md' \| wc -l` | `0` |  |
| B.3.6 | `rg -n 'verify *= *False\|rejectUnauthorized: *false\|InsecureSkipVerify' . -g '!SECURITY.md' -g '!NO-VIBE.md'` | `(vide)` |  |
| B.3.6b | `rg -n 'insecure_skip_verify\|rejectUnauthorized' src` | 2 lignes | vérification du certificat d’une cible en https:// selon la route : un choix de l’administrateur, affiché « certificat non vérifié » dans la liste des routes (REQ-DATA-002, action H20) ; Cloudflare et Telegram toujours vérifiés |
| B.3.7 | `rg -n 'jwt\.decode\(\|algorithms: *\[.*none\|verify: *false' . -g '!SECURITY.md' -g '!NO-VIBE.md' \| wc -l` | `1` | `verify: false` est un champ du `settings.json` d’un Relay 1.x fabriqué pour l’essai de reprise (`test/relay.test.js`) ; aucun jeton JWT |
| B.2.6 | `curl -s -o /dev/null -w '%{http_code}' http://localhost:18195/.env` | `404` | aucun fichier caché servi |
| B.4.1 | `curl -sI http://localhost:18195/ \| rg -i 'content-security\|x-content-type\|referrer-policy\|permissions-policy\|x-frame\|cross-origin' \| wc -l` | `7` | CSP, nosniff, Referrer-Policy, Permissions-Policy, X-Frame-Options, COOP/CORP |
| B.4.2 | `curl -sI http://localhost:18195/ \| rg -i '^(server\|x-powered-by\|x-aspnet\|x-generator)' \| wc -l` | `0` |  |
| B.4.3 | `curl -sI -H 'Origin: https://evil.example' http://localhost:18195/api/etat \| rg -i access-control \| wc -l` | `0` |  |
| B.4.4 | `curl -sI 'http://localhost:18195/connexion?next=https://evil.example' \| rg -i '^location' \| wc -l` | `0` |  |
| B.4.5 | `curl -s -o /dev/null -w '%{http_code}' http://localhost:18195/.git/config` | `404` |  |
| B.4.5b | `curl -s -o /dev/null -w '%{http_code}' http://localhost:18195/v/x/../.git/config; echo; curl -s -o /dev/null -w '%{http_code}' 'http://localhost:18195/v/2.3.0/%2e%2e/src/config.js'` | 2 lignes | aucun chemin ne sort de `web/` |
| B.4.6 | `curl -s -o /dev/null -w %{http_code} http://localhost:18195/api/clients` | `401` | sans identité |
| B.4.7 | `for i in $(seq 1 30); do curl -s -o /dev/null -w '%{http_code} ' -X POST http://localhost:18195/api/compte/connexion -H 'Content-Type: application/json' -H 'Origin: http://localhost:18195' -d '{\"identifiant\":\"quelquun\",\"motDePasse\":\"mauvais mot de passe\"}'; done \| tr ' ' '\n' \| sort \| uniq -c \| tr '\n' ' '` | `3 401      27 428` | le limiteur du socle exige une preuve de travail (428) dès le quatrième échec ; une seconde passe la trouve exigée d’emblée : le compteur persiste |
| B.4.8 | `for i in $(seq 1 25); do curl -s -o /dev/null -w '%{http_code} ' -H 'Authorization: Bearer jeton-invente-0000000000000000000' http://localhost:18195/api/etat; done \| tr ' ' '\n' \| sort \| uniq -c \| tr '\n' ' '` | `10 401      15 429` | le limiteur persistant coupe l’adresse au dixième jeton faux ; une seconde passe la trouve coupée d’emblée |

## Exploratory probing (SEC-TEST-007)
Sondage exploratoire du 2026-10-20, rejoué à chaque génération de ce fichier sur une instance neuve (vrais comptes de chaque rôle, vrai jeton du Hub, vrais jetons de service des deux portées) : 32 cas d’abus tentés, chacun avec la réponse obtenue et celle qu’exige la règle ; un seul écart arrête la génération.

| # | Cas d’abus | Tenté | Obtenu | Attendu |
|---|---|---|---|---|
| P1 | anonyme sur les routes | `GET /api/etat` | 401 | 401 |
| P2 | jeton faux avec un cookie de session valide | `GET /api/etat` + cookie admin + Bearer faux | 401 | 401 |
| P3 | service « soi » qui liste toutes les routes | `GET /api/etat` (carte) | 403 | 403 |
| P4 | service qui reprend le nom d’un autre | `POST /api/register {subdomain: plan}` (carte) | 409 | 409 |
| P5 | service qui retire la route d’un autre | `DELETE /api/register?host=plan.exemple.fr` (carte) | 404 | 404 |
| P6 | service qui change la route d’un autre par l’API des routes | `PATCH /api/routes/<plan>` (carte) | 403 | 403 |
| P7 | service qui publie le relais lui-même | `POST /api/register {upstream: 127.0.0.1:8095}` (carte) | 400 | 400 |
| P8 | service qui publie les métadonnées d’un nuage | `POST /api/register {upstream: 169.254.169.254:80}` (carte) | 400 | 400 |
| P9 | écriture non canonique de la boucle locale | `POST /api/register {upstream: 0x7f.1:80}` (carte) | 400 | 400 |
| P10 | injection dans la configuration de Caddy par la cible | `POST /api/register {upstream: "a:80\"},{\"dial\":\"x"}` (carte) | 400 | 400 |
| P11 | en-tête Host avec saut de ligne | `POST /api/routes {enteteHote: "a\r\nX: 1"}` (admin) | 400 | 400 |
| P12 | service « routes » qui change les domaines de base | `PUT /api/reglages/general` (gestion) | 403 | 403 |
| P13 | service « routes » qui lit l’ingress du tunnel | `POST /api/cloudflare/apercu` (gestion) | 403 | 403 |
| P14 | Hub qui crée un jeton de service | `POST /api/clients` (Hub) | 401 | 401 |
| P15 | Hub qui change le bot Telegram | `PUT /api/reglages/telegram` (Hub) | 401 | 401 |
| P16 | lecture seule qui crée une route | `POST /api/routes` (lecture) | 403 | 403 |
| P17 | membre qui crée une route | `POST /api/routes` (membre) | 403 | 403 |
| P18 | membre qui lit la configuration de Caddy | `GET /api/configuration` (membre) | 403 | 403 |
| P19 | écriture de session sans jeton anti-CSRF | `POST /api/routes` sans X-CSRF (admin) | 403 | 403 |
| P20 | écriture de session depuis une autre origine | `POST /api/routes`, Origin evil.example (admin) | 403 | 403 |
| P21 | champ inconnu (affectation de masse) | `POST /api/register {…, proprietaire: hub}` (carte) | 400 | 400 |
| P22 | prototype pollué | `POST /api/routes {__proto__: …}` (Hub) | 400 | 400 |
| P23 | paramètre non déclaré | `GET /api/whoami?debug=1` (carte) | 400 | 400 |
| P24 | identifiant hors format | `DELETE /api/routes/..%2f..%2fetc` (Hub) | 404 | 404 |
| P25 | corps géant annoncé | `POST /api/routes`, Content-Length 50 Mo (Hub) | 413 | 413 |
| P26 | écriture sans JSON (formulaire d’un autre site) | `POST /api/routes`, text/plain (Hub) | 415 | 415 |
| P27 | méthode inattendue | `TRACE /api/etat` (Hub) | 405 | 405 |
| P28 | route de débogage | `GET /debug`, `/api/debug`, `/.env`, `/.git/config` | 404 404 404 404 | 404 404 404 404 |
| P29 | secret dans les réglages | `GET /api/reglages` (admin) : jeton Telegram | true | true |
| P30 | secret au repos | base relue en brut : jeton Telegram, jetons de services | scellé, empreintes | scellé, empreintes |
| P31 | erreur interne détaillée | `PATCH /api/routes/AAAAAAAAAAAA` (Hub) | 404 sans pile | 404 sans pile |
| P32 | jetons inventés en rafale | douze `GET /api/etat`, jetons faux | bloqué (429) | bloqué (429) |

Suivi du 2026-10-30 (2.3.3) : nouveau logo. L'icône de l'onglet (`web/icone.svg`) et la marque de la barre et de l'écran de connexion (`web/app.js:14`, tracé posé par createElementNS, aucun balisage injecté) prennent le nouveau logo. Les fichiers fournis portaient un manifeste C2PA (métadonnées d'origine) : retiré, comme toute métadonnée, avant d'entrer dans le dépôt (REQ-ANON). Aucun contrôle ne change de statut. Essais : 104 du service et du socle. Parcours du navigateur : 63 écrans × largeurs, 0 défaut, 0 erreur de console.
