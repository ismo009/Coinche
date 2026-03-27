# Coinche (Web Multiplayer)

Jeu de Coinche multijoueur en temps reel (4 joueurs, 2 equipes) jouable directement dans le navigateur via Socket.IO.

## Demarrage rapide

```bash
npm install
npm start
```

Le serveur demarre sur `http://localhost:3000`.

## Partie en reseau local

1. Un joueur cree une salle.
2. Il partage le code de salle (6 caracteres).
3. Les autres rejoignent la meme salle et choisissent une position libre.
4. La partie commence automatiquement a 4 joueurs.

## Fonctionnalites

- Salles multijoueurs en temps reel (create/join).
- Orientation dynamique de la table selon la position du joueur.
- Phase d'encheres complete: passe, coinche, surcoinche.
- Gestion des plis, cartes jouables et regles d'obligation.
- Belote/Rebelote, y compris support en tout-atout.
- Affichage du dernier pli en permanence (coin superieur gauche).
- Historique des manches (contrat, resultat, score manche, score total).
- Interface responsive desktop/mobile.

## Regles implementees (resume)

- 4 joueurs: Nord-Sud vs Est-Ouest.
- 32 cartes: `7 8 9 10 valet dame roi as`.
- Contrats: `80` a `160`, `250` (capot), `270` (capot belote), `500` (generale).
- Atouts: `coeur`, `carreau`, `trefle`, `pique`, `tout-atout`, `sans-atout`.
- Dernier pli: +10 points.
- Belote/Rebelote: +20 points (selon les conditions du contrat).
- Score cible de partie: `2000` points.

## Valeurs des cartes

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

## Architecture du projet

```text
.
|-- game.js               # Moteur de jeu (regles, scoring, etats)
|-- server.js             # Serveur Express + Socket.IO
|-- package.json
`-- public/
	|-- index.html        # Structure de l'interface
	|-- style.css         # Theme et layout
	`-- game-client.js    # Client Socket.IO + rendu UI
```

## Scripts npm

- `npm start`: lance `node server.js`.

## Notes

- Le projet est en JavaScript vanilla (pas de framework front).
- Les regles peuvent etre ajustees dans `game.js` si vous voulez une variante de Coinche locale.

