# Code quality record — Relay

Method: Project Baseline Requirements & Security Manual, Part III (chapters 37-49)
Reviewed: 2026-10-20   ·   Owner: Codex64

## Behaviour freeze
Point de départ : `v2.2.0`. Ensemble de référence relevé avant toute modification : 19 essais du service, tous verts, et l’inventaire des 33 routes de l’API. Sur l’arbre final : 27 essais du service (dont l’exercice du runbook) et 63 du socle embarqué, désormais rejoués par `npm test`, tous verts. La suite de `v2.2.0` relancée telle quelle contre l’arbre final : 17 sur 19 passent ; les deux autres attendent exactement ce que corrigent les constats R4 (un service publiait la boucle locale) et R1 (le CNAME écrit porte maintenant la marque de Relay), et leurs versions à jour les vérifient.

Diff de l’API publique : les 33 routes gardent leurs chemins et leurs méthodes (`diff` des déclarations de `src/api.js` entre `v2.2.0` et l’arbre final : vide) ; le contrat de la 1.x (`/api/register`, `/api/whoami`, `/api/heartbeat`) garde ses champs anglais et ses réponses. Changements voulus, chacun le correctif d’un constat de SECURITY.md : un jeton « routes » reçoit 403 sur les réglages et Cloudflare (R3) ; une cible de boucle locale ou de lien local donnée par un jeton de service → 400 (R4) ; une entrée d’ingress ou un CNAME tenus par un autre ne sont plus pris (avertissement) ni retirés (R1) ; `GET /api/configuration` rend « (scellé) » à la place du jeton Cloudflare (R2) ; une reprise illisible arrête le démarrage (R9) ; installé seul, Relay lit sa clé dans un secret Docker (R8).

Démarrage et parcours de bout en bout sur l’arbre final, le 2026-10-20 : `outils/exercice-incident.mjs` → 28 vérifications réussies ; parcours de l’interface dans Chromium contre la vitrine (`outils/parcours-navigateur.mjs`) → 63 écrans et largeurs, aucun défaut de mise en page, aucune erreur en console ni violation de la politique de contenu.

## Layer status
| Chapter | Subject | Status | What changed |
|---|---|---|---|
| 39 | Comment layer | DONE | 16 bandeaux de section en tirets retirés ; les trois qui disaient quelque chose gardés en phrase (`29d636d`) ; chaque prise d’erreur silencieuse dit sa raison à côté (`1118e9f`) ; les commentaires restants disent une raison (contrat, menace, choix de Caddy ou de Cloudflare), aucun ne raconte le code ; l’en-tête de `src/cloudflare.js` corrigé pour dire ce que le code garantit vraiment (`4e8e273`) |
| 40 | Naming and vocabulary | DONE | vocabulaire du dépôt gardé : français pour le domaine (route, cible, service raccordé, renfort, reprise), anglais là où il est contrat (champs de la 1.x, configuration de Caddy, API de Cloudflare) ; noms ajoutés dans la même langue (`cibleInterdite`, `horsServices`, `resceller`, `ecrireDnsSignale`) |
| 41 | Formatting, layout and whitespace | DONE | aucun formateur dans le dépôt, aucun introduit ; 2 espaces, apostrophes simples, points-virgules, lignes longues de l’existant respectées ; `git diff --check` depuis l’arbre vide : propre ; aucun caractère invisible |
| 42 | Gratuitous abstraction | DONE | aucune interface à une seule implémentation ; la reprise d’une 1.x passe par la même fonction que la saisie (`normaliser`) au lieu d’un second contrôle ; la ligne de commande reprend `Magasin`, `Relais`, `Caddy` et `Cloudflare` tels quels |
| 43 | Defensive noise | DONE | une écriture des noms locaux n’est plus avalée à chaque tour : signalée une fois, et sa fin aussi (`3af36a0`) ; une reprise illisible n’est plus avalée (`d96c0e2`) ; 55 `catch` rangés ci-dessous selon ce que fait leur bloc ; aucun message vague, aucune journalisation d’entrée ou de sortie de fonction |
| 44 | Control flow and idiom | DONE | retours anticipés ; appelant établi d’abord (`appelant`), puis portée (`surLesRoutes`, `horsServices`, `service`, `hub`), puis corps validé, en tête de chaque route |
| 45 | Types, signatures and data shapes | DONE | JavaScript sans TypeScript ; contrat d’erreur : `ErreurHttp` du socle, et les refus de Caddy ou de Cloudflare en erreurs portant `status: 502`, traduits une fois à la frontière (`traiter`) ; schémas au validateur du socle |
| 46 | Dependencies, configuration, fitting the repository | DONE | aucune dépendance npm, contrôlé en CI ; image Node par empreinte ; clé maîtresse d’une installation seule en secret Docker, plafonds et journaux bornés comme dans le manifeste du Hub (`5abc872`) ; reste à épingler l’image de construction de Caddy et son module DNS (SECURITY.md, H17) |
| 47 | Tests | DONE | 28 cassures volontaires, chacune détectée (ci-dessous) ; cinq passaient d’abord inaperçues et ont donné des essais (`90cbca0`) ; tables des droits pour les deux portées de jeton et le jeton du Hub ; runbook d’incident joué par les essais (`62dacb8`) ; essais du socle dans `npm test` (`814e135`) |
| 48 | Documentation, furniture and version control | DONE | README (Relay seul avec la clé en secret, reprise de la clé du volume, rotation, sauvegardes, incident), INTEGRATION.md (nouvelle réponse 400), notice de confidentialité, Compose, manifeste du Hub (ce qu’ouvre son jeton dit tel quel), Dependabot, vérification CI ; un sujet par commit, sans mention d’outil, en UTC |

`catch` restants, par raison (`rg -o 'catch\s*(\(\s*\w*\s*\))?\s*\{|\.catch\(' src web outils test`, 55), classés à la lecture de chaque bloc :

| Raison | Nombre | Où |
|---|---|---|
| relevée, traduite en erreur du domaine ou transmise (y compris défaire l’écriture en base puis relancer) | 19 | `src/api.js`, `src/relais.js`, `src/cloudflare.js`, `src/base.js`, `src/reprise.js`, `src/main.js`, `src/cli.js` |
| montrée à l’écran, rendue au demandeur, portée dans l’état ou en avertissement, avec sa cause | 17 | `web/app.js`, `src/telegram.js`, `src/relais.js`, `src/api.js`, `src/cli.js`, `src/reprise.js` |
| valeur de repli explicite (réponse illisible de Cloudflare, Telegram ou Caddy, réglage illisible, fichier pas encore écrit, corps non JSON) | 7 | `src/cloudflare.js`, `src/telegram.js`, `src/base.js`, `src/caddy.js`, `src/relais.js`, `web/app.js` |
| en fond, sans effet voulu, la raison écrite à côté (sonde, rechargement, alerte, processus déjà arrêté, session finie) | 7 | `src/relais.js`, `src/api.js`, `src/telegram.js`, `web/app.js`, `outils/` |
| contrôle du rescellement : essai sous l’autre clé, secret illisible compté au bilan et journalisé | 2 | `src/base.js` |
| journalisée | 2 | `src/main.js` |
| signalée une fois par Telegram | 1 | `src/relais.js` |

## Tests
Cassures volontaires (REQ-CODE-005) : chacune posée seule, les essais du service lancés en entier, le fichier rétabli (`mutations.py`, hors dépôt), sur l’arbre final.

| Cassure | Fichier | Essais en échec | Premier essai qui échoue |
|---|---|---|---|
| un jeton de service « soi » touche toutes les routes | `src/api.js` | 2 | « services raccordés : jeton montré une fois, portée « soi » bornée à ses routes, révocation qui emporte ses routes » |
| un jeton « routes » règle Relay | `src/api.js` | 1 | « autorisation : un jeton « routes » gère les routes, ni les réglages ni Cloudflare ; le jeton du Hub ni les comptes, ni les jetons de services, ni Telegram » |
| un jeton faux ne compte plus | `src/api.js` | 1 | « autorisation : sans session ni jeton, rien ; la lecture voit, n’écrit pas ; un faux jeton est compté » |
| un jeton faux retombe sur la session | `src/api.js` | 3 | « exercice du runbook d'incident : chaque geste par son vrai chemin, son effet vérifié » |
| le jeton du Hub ouvre les comptes de services | `src/api.js` | 1 | « autorisation : un jeton « routes » gère les routes, ni les réglages ni Cloudflare ; le jeton du Hub ni les comptes, ni les jetons de services, ni Telegram » |
| raccorder un service sans renfort | `src/api.js` | 1 | « services raccordés : jeton montré une fois, portée « soi » bornée à ses routes, révocation qui emporte ses routes » |
| changer le bot Telegram sans renfort | `src/api.js` | 1 | « routes à la main : créer, mettre en pause, retirer ; une cible morte est signalée par Telegram » |
| un service publie sur le nom d’un autre | `src/api.js` | 1 | « services raccordés : jeton montré une fois, portée « soi » bornée à ses routes, révocation qui emporte ses routes » |
| le Hub prend le nom d’un autre propriétaire | `src/api.js` | 1 | « publication par le Hub : idempotente, au domaine de base, jamais sur le nom d’un autre » |
| un service vise la machine du relais | `src/api.js` | 2 | « services raccordés : jeton montré une fois, portée « soi » bornée à ses routes, révocation qui emporte ses routes » |
| le jeton Cloudflare redescend dans la configuration | `src/api.js` | 1 | « configuration lue par l’admin : le jeton Cloudflare du défi DNS n’en sort pas » |
| un paramètre de requête non déclaré passe | `src/api.js` | 1 | « autorisation : sans session ni jeton, rien ; la lecture voit, n’écrit pas ; un faux jeton est compté » |
| un secret des réglages redescend | `src/base.js` | 2 | « routes à la main : créer, mettre en pause, retirer ; une cible morte est signalée par Telegram » |
| un jeton de service gardé en clair | `src/base.js` | 4 | « exercice du runbook d'incident : chaque geste par son vrai chemin, son effet vérifié » |
| la base lisible de tous | `src/base.js` | 1 | « base : dossier en 0700, base et journaux WAL en 0600, même sous un masque permissif (ligne de commande) » |
| une cible avec chemin ou identifiants passe | `src/base.js` | 2 | « saisie : nom, cible et mode contrôlés ; le tunnel force le mode sans TLS » |
| un en-tête Host arbitraire passe | `src/relais.js` | 1 | « reprise d’un Relay 1.x : routes, services (jetons toujours valables) et réglages, secrets scellés » |
| Cloudflare prend l’entrée d’un autre dans le tunnel | `src/cloudflare.js` | 2 | « Cloudflare : le nom qu’un autre tient dans le tunnel ou le DNS n’est ni pris ni retiré » |
| Cloudflare remplace le CNAME d’un autre tunnel | `src/cloudflare.js` | 2 | « Cloudflare : le nom qu’un autre tient dans le tunnel ou le DNS n’est ni pris ni retiré » |
| Cloudflare retire un enregistrement qu’il n’a pas écrit | `src/cloudflare.js` | 1 | « Cloudflare : le nom qu’un autre tient dans le tunnel ou le DNS n’est ni pris ni retiré » |
| un enregistrement A d’un autre est remplacé | `src/cloudflare.js` | 2 | « domaines chez Cloudflare depuis le Hub : jeton écrit jamais relu, nom local → A vers la machine, certificat Let’s Encrypt, rien d’autre touché » |
| une écriture refusée par Caddy reste en base | `src/relais.js` | 11 | « une écriture que Caddy refuse est défaite, et son message remonte tel quel » |
| les codes de liaison Telegram sans limite | `src/telegram.js` | 1 | « Telegram : un chat se lie par le code affiché, un autre code ne lie rien ; seul le chat lié commande » |
| un chat inconnu commande le bot | `src/telegram.js` | 1 | « Telegram : un chat se lie par le code affiché, un autre code ne lie rien ; seul le chat lié commande » |
| les jetons ne sont plus rescellés après rotation | `src/main.js` | 1 | « exercice du runbook d'incident : chaque geste par son vrai chemin, son effet vérifié » |
| la reprise passe un en-tête Host invalide | `src/reprise.js` | 1 | « reprise d’un Relay 1.x : routes, services (jetons toujours valables) et réglages, secrets scellés » |
| une sauvegarde restaurée par-dessus une base | `src/cli.js` | 1 | « ligne de commande : sauvegarde chiffrée pour une clé publique, restaurée ailleurs ; secrets retirés pour un incident, Caddy suit » |
| Caddy garde le jeton Cloudflare après son retrait | `src/cli.js` | 1 | « ligne de commande : sauvegarde chiffrée pour une clé publique, restaurée ailleurs ; secrets retirés pour un incident, Caddy suit » |

Cassures manquées : 0 (cinq passaient d’abord inaperçues — jeton faux non compté, jeton du Hub sur les jetons de services, nom d’un autre par le contrat de la 1.x, chat non lié, droits de la base sous un masque permissif : des essais les ont ajoutées, `90cbca0`).

## Repository style profile
Node 24 sans dépendance, modules ES ; 2 espaces, apostrophes simples, points-virgules ; une route = un appel `r.get/post/put/patch/del` de `src/api.js`, son schéma dans la table `S`, l’appelant et sa portée vérifiés en tête ; erreurs du client en `ErreurHttp`, refus de Caddy et Cloudflare en 502 avec leur message ; la base derrière `Magasin` (`src/base.js`), Caddy derrière `Caddy` (configuration entière poussée sur `/load`), Cloudflare derrière `Cloudflare`, le cœur dans `Relais` ; essais `node:test` contre le vrai serveur, un faux Caddy sur un socket Unix et de fausses API, aides du socle pour les comptes (`socle/essai/`) ; interface : DOM construit par `h()`, texte seulement ; commentaires en français, qui disent une raison ; commits d’une ligne, un sujet chacun.

Aides existantes réutilisées plutôt que réinventées : lecture bornée du corps, schémas, limiteur persistant, coffre, journal chaîné, sauvegarde chiffrée et en-têtes du socle ; `normaliser` pour toute route, saisie ou reprise ; `appliquer` pour toute écriture vers Caddy.

## Detection sweep
Annexe B.5, sur l’arbre final (`b5.sh`, hors dépôt ; `socle/` exclu, le socle ayant son propre relevé) :

```
B.5.1	0 lignes
B.5.2	0 lignes
B.5.3	0 lignes
B.5.4	0 lignes
B.5.5	0 lignes
B.5.6	0 lignes
B.5.7	7
B.5.8	0 lignes
B.5.9	2 lignes
    caddyService
    cibleDeService
B.5.10	0 lignes
B.5.11	4 lignes
    ./test/relay.test.js:18:const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-'));
    ./test/relay.test.js:53:    const ok = result => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, ok: true, result })); };
    ./src/relais.js:201:      }, res => { res.resume(); res.destroy(); fin(res.statusCode < 500, { code: res.statusCode }); });
    ./src/caddy.js:83:      }, res => {
B.5.12	48
B.5.12b	9
B.5.13	0 lignes
B.5.14	0 lignes
B.5.15	0 lignes
41.1.1	0 lignes
41.2.1	0 lignes
45.1.1	0 lignes
47.1.1	0 lignes
48.3.1	0 lignes
48.3.2	10
48.3.3	0 lignes
48.4.1	0 lignes
```

Justification de chaque résultat non nul : B.5.7, les pictogrammes des messages Telegram (état d’une route, alerte, essai), voulus dans un message de chat ; B.5.9, `caddyService` (l’adresse du service Caddy vue du tunnel, nom de réglage) et `cibleDeService` (la cible donnée par un service raccordé) — le mot « service » y est du domaine, pas un suffixe de classe ; B.5.11, `res` est la réponse HTTP des rappels de `http.request`, `tmp` le dossier temporaire et `result` le champ du protocole de Cloudflare dans la fausse API des essais ; B.5.12 et B.5.12b, les `catch` rangés plus haut ; 48.3.2, des attributs `placeholder` de champs de formulaire.

## Verification (chapter 49)
- [x] Full suite passes and matches the baseline — 27 essais du service et 63 du socle, verts ; 17 des 19 essais de départ passent inchangés, les 2 autres attendaient les défauts corrigés par R1 et R4 (« Behaviour freeze »)
- [x] Public API diff empty — mêmes 33 routes, mêmes chemins et méthodes, contrat de la 1.x inchangé ; les seuls écarts sont les correctifs listés plus haut
- [x] Characterisation tests deleted after use — aucun essai de caractérisation écrit : la référence était la suite existante, et chaque changement de comportement voulu a son essai de non-régression, gardé
- [x] Read-aloud test passed — en-têtes, commentaires et messages d’erreur relus à voix haute : ils disent une raison ou un fait, sans formule
- [x] Blind-comparison test passed — le code ajouté (ligne de commande, rescellement, contrôle des cibles, exercice du runbook) reprend la forme des fichiers voisins et du socle ; rien ne le distingue par ses bandeaux, ses noms ou ses `catch`
- [x] Commit history: one concern per commit, repository style, no attribution trailers — `git log --format=%b v2.2.0..main | grep -c .` → 0 ; identité, fuseau et mentions d’outil contrôlés en CI
- [x] REQ-CODE-001 to REQ-CODE-006 all PASS — voir SECURITY.md
