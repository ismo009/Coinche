# ♠ Coinche ♥

Jeu de Coinche multijoueur en ligne — jouez à 4 (2 équipes) directement dans le navigateur !

## Lancer le jeu

```bash
npm install
npm start
```

Puis ouvre **http://localhost:3000** dans ton navigateur.

## Comment jouer

1. **Créer une salle** : entre ton pseudo, choisis ta position (Sud/Nord/Est/Ouest), clique "Créer"
2. **Partager le code** : un code à 6 caractères s'affiche — envoie-le à tes amis
3. **Rejoindre** : tes amis entrent le code et choisissent une position libre
4. **La partie commence** quand 4 joueurs sont connectés

## Règles de la Coinche

- **4 joueurs, 2 équipes** : Nord-Sud vs Est-Ouest
- **32 cartes** : 7, 8, 9, 10, Valet, Dame, Roi, As de chaque couleur
- **Phase d'enchères** : annoncez un contrat (points + atout), coincez ou surcoincez
- **Phase de jeu** : 8 plis, fournissez la couleur demandée, coupez si nécessaire
- **Objectif** : atteindre 701 points pour gagner la partie

### Valeurs des cartes

| Carte | En atout | Hors atout |
|-------|----------|------------|
| Valet | 20       | 2          |
| 9     | 14       | 0          |
| As    | 11       | 11         |
| 10    | 10       | 10         |
| Roi   | 4        | 4          |
| Dame  | 3        | 3          |
| 8     | 0        | 0          |
| 7     | 0        | 0          |

### Points spéciaux
- **Dernier pli** : +10 points
- **Belote/Rebelote** (Roi + Dame d'atout) : +20 points
- **Total par manche** : 162 points (+ bonuses)

## Structure du projet

```
├── server.js          # Serveur Express + Socket.IO
├── game.js            # Moteur de jeu (règles de la Coinche)
├── package.json
├── public/
│   ├── index.html     # Interface du jeu
│   ├── style.css      # Styles
│   └── game-client.js # Logique côté client
```

