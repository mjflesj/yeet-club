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

## Architecture

```
server.js          serveur HTTP (fichiers de public/) + WebSocket (salles)
public/game.js     simulation du jeu, partagée entre le serveur et le navigateur
public/client.js   rendu canvas, entrées, son, menus, connexion au serveur
public/index.html  page et styles
```

Le serveur fait autorité : il simule chaque partie à 120 Hz, reçoit les entrées des joueurs et diffuse l'état 30 fois par seconde. Les clients affichent cet état avec 100 ms d'interpolation pour rester fluides. Si un joueur se déconnecte en pleine partie, un bot reprend son personnage.

### Messages WebSocket

| Sens | Message | Rôle |
|------|---------|------|
| client → serveur | `{t:'create', name}` | crée une salle |
| client → serveur | `{t:'join', code, name}` | rejoint une salle |
| client → serveur | `{t:'seat', i}` | (hôte) ajoute ou retire un bot sur la place `i` |
| client → serveur | `{t:'stocks', n}` | (hôte) nombre de vies |
| client → serveur | `{t:'start'}` | (hôte) lance la partie |
| client → serveur | `{t:'in', x, u, d, a, b}` | entrées du joueur |
| client → serveur | `{t:'leave'}` | quitte la salle |
| serveur → client | `{t:'room', …}` | état du salon |
| serveur → client | `{t:'start'}` / `{t:'snap', v, e}` / `{t:'end', r}` | partie : début, état + événements, résultats |
| serveur → client | `{t:'err', msg}` | erreur à afficher |

## Commandes

| Contrôle  | Bouger / sauter | Pousser | Choper / lancer |
|-----------|-----------------|---------|-----------------|
| Clavier 1 | ZQSD ou WASD    | F       | G               |
| Clavier 2 | Flèches         | N       | M               |
| Manette   | Stick + A       | X / RB  | B / LB          |

En ligne, tous ces contrôles pilotent ton personnage.

- Plus ton % de dégâts monte, plus tu voles loin.
- Haut + choper : lancer vers le ciel. Bas sur une passerelle : la traverser.
- Chopé ? Martèle les boutons pour te libérer.
- Objets : caisse (se lance), bombe (explose 3 s après ramassage), batte (4 coups).

Règle n°1 : tout le monde parle du Yeet Club.
