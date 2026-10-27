# YEET CLUB — La bagarre physique

Des petits personnages se poussent, se lancent et utilisent des objets pour éjecter les autres de l'arène. Le dernier debout gagne.

- **En ligne** : jusqu'à 4 joueurs, chacun sur son appareil. On crée une salle, on partage le code (ou le lien) et on se bat. L'hôte peut compléter avec des bots.
- **Même écran** : jusqu'à 4 joueurs sur un seul ordinateur (2 claviers, manettes, tactile) avec des bots.

## Lancer le serveur

Il faut Node.js 18 ou plus récent.

```bash
npm install
npm start
```

Ouvre ensuite http://localhost:3000. Le port se change avec la variable `PORT` :

```bash
PORT=8080 npm start
```

Pour jouer en ligne avec des amis, héberge le serveur sur une plateforme Node qui accepte les WebSockets (Render, Railway, Fly.io, un VPS…) : commande de démarrage `npm start`, contrôle de santé sur `/health`. GitHub Pages ne suffit pas, car il ne peut pas faire tourner le serveur.

## Installer sur un serveur OVH (VPS)

1. Dans l'espace client OVH, fais pointer ton nom de domaine (ou un sous-domaine, ex. `yeetclub.mondomaine.fr`) vers l'adresse IP du VPS : enregistrement DNS de type **A**.
2. Connecte-toi au serveur en SSH, puis :

```bash
curl -fsSL https://raw.githubusercontent.com/mjflesj/yeet-club/main/deploy/install-ovh.sh -o install-ovh.sh
sudo bash install-ovh.sh yeetclub.mondomaine.fr ton@email.fr
```

Le script installe Node.js, nginx et un certificat HTTPS gratuit (Let's Encrypt), puis lance le jeu comme service (`yeet-club`) qui redémarre tout seul. Réglages dans `/etc/yeet-club.env`.

Mettre à jour après un changement sur GitHub : `sudo bash /opt/yeet-club/deploy/update.sh`

Un hébergement **mutualisé** OVH ne convient pas : il ne peut pas faire tourner Node.js ni les WebSockets. Il faut un VPS (ou un serveur dédié / Public Cloud).

## Version Android (Google Play)

Le dossier `android/` contient une application Android de type *Trusted Web Activity* : elle ouvre le jeu hébergé sur ton serveur, en plein écran et sans barre d'adresse. Nom du package : `io.github.mjflesj.yeetclub`.

Elle est construite par GitHub Actions (onglet **Actions** → **Android** → *Run workflow*) :

1. **Adresse du serveur** : *Settings → Secrets and variables → Actions → Variables* → `TWA_HOST` = ton domaine, sans `https://` (ex. `yeetclub.mondomaine.fr`).
2. **Clé d'envoi** (une seule fois, à garder précieusement) :
   ```bash
   keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 upload.jks   # à copier dans le secret ANDROID_KEYSTORE_BASE64
   ```
   Secrets à créer : `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`upload`), `ANDROID_KEY_PASSWORD`.
3. Lance le workflow : il produit un `.aab` (à envoyer dans la Play Console) et un `.apk` (à installer sur un téléphone pour tester).
4. **Lier le site à l'appli** : dans la Play Console, *Intégrité de l'application → Signature d'application*, copie l'empreinte **SHA-256 de la clé de signature d'application**, et mets-la dans `/etc/yeet-club.env` sur le serveur :
   ```
   ANDROID_CERT_SHA256=AA:BB:CC:...
   ```
   puis `sudo systemctl restart yeet-club`. Le serveur publie alors `/.well-known/assetlinks.json`. Sans cette étape, l'appli s'ouvre avec une barre d'adresse en haut. Pour tester un APK signé avec ta clé d'envoi, ajoute aussi son empreinte (affichée dans le résumé du workflow), séparée par une virgule.

Images pour la fiche Play Store : `store/icon-512.png` et `store/feature-graphic-1024x500.png`.

Le jeu est aussi installable comme application web (manifeste + service worker) : « Ajouter à l'écran d'accueil » sur iPhone et Android.

## Architecture

```
server.js          serveur HTTP (fichiers de public/) + WebSocket (salles)
public/game.js     simulation du jeu, partagée entre le serveur et le navigateur
public/client.js   rendu canvas, entrées, son, menus, connexion au serveur
public/index.html  page et styles
public/sw.js       copie hors ligne (application web installable)
android/           application Android (Trusted Web Activity)
deploy/            installation et mise à jour sur un VPS OVH
store/             images pour la fiche Google Play
```

Le serveur fait autorité : il simule chaque partie à 120 Hz et diffuse l'état 60 fois par seconde. Si un joueur se déconnecte en pleine partie, un bot reprend son personnage.

Pour supprimer le délai ressenti :

- **Prédiction locale** : le client envoie ses entrées 60 fois par seconde, numérotées, et les applique tout de suite à son propre personnage avec la même physique que le serveur (`predictStep` dans `game.js`).
- **Réconciliation** : chaque instantané indique la dernière entrée traitée par le serveur. Le client repart de l'état du serveur, rejoue les entrées pas encore traitées et lisse le petit écart restant.
- **Autres joueurs** : affichés avec seulement 50 ms d'interpolation.

### Messages WebSocket

| Sens | Message | Rôle |
|------|---------|------|
| client → serveur | `{t:'create', name, sk}` | crée une salle (`sk` = compétences) |
| client → serveur | `{t:'join', code, name, sk}` | rejoint une salle |
| client → serveur | `{t:'skills', sk}` | change ses compétences dans le salon |
| client → serveur | `{t:'seat', i}` | (hôte) ajoute ou retire un bot sur la place `i` |
| client → serveur | `{t:'stocks', n}` | (hôte) nombre de vies |
| client → serveur | `{t:'start'}` | (hôte) lance la partie |
| client → serveur | `{t:'again'}` | (n'importe quel joueur) relance une partie après la fin d'un round |
| client → serveur | `{t:'in', s, x, u, d, a, b}` | entrées du joueur (`s` = numéro de séquence), 60 par seconde |
| client → serveur | `{t:'leave'}` | quitte la salle |
| serveur → client | `{t:'room', …}` | état du salon |
| serveur → client | `{t:'start'}` / `{t:'snap', v, e}` / `{t:'end', r}` | partie : début, état + événements, résultats |
| serveur → client | `{t:'err', msg}` | erreur à afficher |

## Compétences

Avant la partie, chaque joueur choisit jusqu'à **2 compétences** parmi 10 (dans le salon en ligne, ou par joueur dans « Même écran »). Les bots en tirent 2 au hasard.

| Compétence | Effet |
|---|---|
| Ressort | Un troisième saut en l'air |
| Sprinteur | Cours 20 % plus vite |
| Poids lourd | Tu voles 25 % moins loin, mais tu cours 10 % moins vite |
| Poings de fer | Poussées 40 % plus fortes, +3 % de dégâts |
| Gros bras | Lancers (joueurs et objets) 35 % plus forts |
| Gecko | Deux accroches au mur par saut, tenues deux fois plus longtemps |
| Increvable | Une vie en plus |
| Artificier | Tes bombes explosent 40 % plus large ; les explosions te font moitié moins |
| Anguille | Tu t'échappes deux fois plus vite quand on te chope |
| Réflexes | Tu reprends le contrôle 35 % plus vite après un coup |

Les compétences sont définies dans `SKILLS` et appliquées par `applySkills` (`public/game.js`), côté serveur comme dans la prédiction du client.

## Commandes

| Contrôle  | Bouger / sauter | Pousser | Choper / lancer |
|-----------|-----------------|---------|-----------------|
| Clavier 1 | ZQSD ou WASD    | F       | G               |
| Clavier 2 | Flèches         | N       | M               |

Les touches des deux claviers se changent dans l'onglet **Touches** du menu, y compris avec les boutons de la souris (gauche, droit, molette, boutons latéraux) ; elles restent enregistrées dans le navigateur.
| Manette   | Stick + A       | X / RB  | B / LB          |

En ligne, tous ces contrôles pilotent ton personnage.

**Sur téléphone** (en paysage) : glisse le pouce sur la moitié gauche de l'écran pour bouger (vers le haut = sauter, vers le bas = traverser une passerelle). À droite : SAUT, POUSSE, CHOPE. Le jeu passe en plein écran au lancement quand le navigateur le permet.

- Plus ton % de dégâts monte, plus tu voles loin.
- Haut + choper : lancer vers le ciel. Bas sur une passerelle : la traverser.
- Éjecté sous le ring ? Pousse contre le mur pour t'y agripper (une fois par saut), puis saute pour remonter.
- Chopé ? Martèle les boutons pour te libérer.
- Objets : caisse (se lance), bombe (explose 3 s après ramassage), batte (4 coups).

Règle n°1 : tout le monde parle du Yeet Club.
