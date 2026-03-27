# Coinche (Web Multiplayer)

Jeu de Coinche 4 joueurs en temps reel, jouable dans le navigateur avec Socket.IO.

## Apercu

- Mode actuel: salle privee via code (6 caracteres).
- 4 joueurs: Nord-Sud vs Est-Ouest.
- Interface web responsive (desktop/mobile) avec table orientee selon la position du joueur.

## Installation

Prerequis:

- Node.js (version recente, 18+ recommandee)
- npm

Puis:

```bash
npm install
npm start
```

Serveur disponible sur `http://localhost:3000`.

## Comment jouer (reseau local)

1. Un joueur cree une salle.
2. Il partage le code de salle affiche en attente.
3. Les autres joueurs rejoignent avec ce code et choisissent une position libre.
4. La partie demarre automatiquement a 4 joueurs.

## Fonctionnalites implementees

- Gestion des salles privees en temps reel (creation/rejoindre).
- Verification des positions disponibles avant de rejoindre.
- Chat de table en direct.
- Encheres completes: passe, coinche, surcoinche, contrats speciaux.
- Gestion des plis et validation des cartes jouables selon les regles.
- Belote/Rebelote (incluant le support tout-atout).
- Score de manche et score cumule jusqu'a la fin de partie.
- Historique des manches.
- Affichage du dernier pli.
- Panneaux d'interface deplacables sur desktop.

## Regles de jeu (resume)

- Jeu a 4 joueurs (2 equipes).
- Paquet de 32 cartes: `7 8 9 10 valet dame roi as`.
- Contrats: `80` a `160`, `250` (capot), `270` (capot belote), `500` (generale).
- Atouts: `coeur`, `carreau`, `trefle`, `pique`, `tout-atout`, `sans-atout`.
- Dernier pli: +10 points.
- Belote/Rebelote: +20 points.
- Score cible de partie: `2000` points.

## Valeur des cartes

### Atout classique

| Carte | Valeur |
| --- | ---: |
| valet | 20 |
| 9 | 14 |
| as | 11 |
| 10 | 10 |
| roi | 4 |
| dame | 3 |
| 8 | 0 |
| 7 | 0 |

### Hors atout

| Carte | Valeur |
| --- | ---: |
| as | 11 |
| 10 | 10 |
| roi | 4 |
| dame | 3 |
| valet | 2 |
| 9 | 0 |
| 8 | 0 |
| 7 | 0 |

## Structure du projet

```text
.
|-- game.js               # Moteur de jeu (regles, scoring, etats)
|-- server.js             # Serveur Express + Socket.IO
|-- package.json
`-- public/
	|-- index.html        # Structure de l'interface
	|-- style.css         # Theme et layout
	|-- game-client.js    # Client Socket.IO + rendu UI
	|-- cards/            # Textures de cartes
	`-- logo/             # Ressources visuelles (branding)
```

## Scripts

- `npm start`: lance `node server.js`.

## Personnalisation rapide

- Regles/scoring: `game.js`
- Interface/layout: `public/style.css` et `public/index.html`
- Logique client temps reel: `public/game-client.js`

## Roadmap (idee)

- Parties publiques avec liste de salles.
- Reconnexion automatique en cas de perte reseau.

