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
- Changement de place dans la salle d'attente : cliquer sur un siege libre pour s'y placer
  (impossible une fois la partie lancee).
- Chat de table en direct.
- Encheres completes: passe, coinche, surcoinche, contrats speciaux.
- Gestion des plis et validation des cartes jouables selon les regles.
- Belote/Rebelote (incluant le support tout-atout).
- Score de manche et score cumule jusqu'a la fin de partie.
- Historique des manches.
- Affichage du dernier pli.
- Panneaux d'interface deplacables sur desktop.
- IA serveur (`ai/coinche-bot.js`) avec logique des appels (voir plus bas).
- Animations legeres : distribution des cartes (3-2-3 depuis le paquet), arrivee des cartes
  depuis le siege du joueur, mise en valeur du gagnant du pli, annonces au-dessus des sieges
  (passe, enchere, coinche, belote, points du pli), bannieres de contrat / reussite / chute.
- Interface mobile dediee : HUD fixe (scores, Pli, Histo, Chat), main en eventail sur une ligne,
  encheres en feuille compacte au-dessus de la main (la main reste visible), mode paysage.
- Theme visuel "arcade" (inspire de Balatro) : aplats, ombres dures, police pixel *Jersey 10*.

## Performances

- Animations uniquement en `transform` / `opacity` (composition GPU), pas de `backdrop-filter`.
- `prefers-reduced-motion` respecte (animations desactivees).
- Images optimisees : logo 512px (~90 Ko), cartes *Classic* 280px de large (~460 Ko pour le paquet).

## Regles de jeu (resume)

- Jeu a 4 joueurs (2 equipes).
- Paquet de 32 cartes: `7 8 9 10 valet dame roi as`.
- Contrats: `80` a `160`, `250` (capot), `270` (capot belote), `500` (generale).
- Atouts: `coeur`, `carreau`, `trefle`, `pique`, `tout-atout`, `sans-atout`.
- Dernier pli: +10 points.
- Generale (500) : l'annonceur entame obligatoirement le premier pli, meme si ce n'est pas son tour.
- Coinche / surcoinche : peuvent s'annoncer a tout moment des encheres, sans attendre son tour
  (la coinche par un adversaire de l'equipe qui a annonce, la surcoinche par l'equipe coinchee).
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

## Noms d'equipe

Chaque equipe (Nord-Sud et Est-Ouest) peut se donner un nom : dans la salle d'attente, champ « Nom de ton equipe » puis
« Nommer » ; en cours de partie, clic sur le nom de son equipe dans le tableau des scores, ou `/team <nom>` dans le chat
(`/team` seul remet le nom par defaut). N'importe quel membre de l'equipe peut la renommer, a tout moment
(24 caracteres max, un changement toutes les 2 secondes). Le nom est conserve pendant toute la vie de la salle et
apparait dans le tableau des scores, les points de la manche, la fin de manche, l'historique et les messages.
Sur telephone, le tableau des scores garde l'affichage compact « NS / EO ».

## Statistiques des joueurs

L'onglet « Statistiques » de l'accueil (ou l'adresse `/#stats`) affiche le classement : parties jouees, victoires,
defaites, % de victoires, contrats reussis, contrats rates et % de contrats reussis. Tri par clic sur les en-tetes,
recherche par pseudo, pseudo courant mis en evidence. Un contrat est compte au preneur a chaque fin de manche, une
partie a chaque joueur humain assis lorsqu'elle se termine ; les IA et le pseudo par defaut « Joueur » ne sont pas comptes.

Les statistiques sont liees au **pseudo** (sans compte ni mot de passe : n'importe qui peut jouer sous un pseudo
existant) et enregistrees cote serveur dans `data/stats.json` (chemin modifiable avec la variable d'environnement
`STATS_FILE`, dossier ignore par git). API JSON : `GET /api/stats` (`?q=` pour chercher un pseudo).

## Emotes

Pendant une partie ou dans la salle d'attente, le bouton **Emotes** (en haut a droite sur telephone, en bas a gauche
sur ordinateur) ouvre le choix des images : l'emote apparait quelques secondes au-dessus de ton siege pour tous les
joueurs de la table (une emote toutes les 1,5 s au maximum ; Echap ou un clic ailleurs ferme le panneau).

**Ajouter une emote** : deposer un fichier PNG **256x256 avec fond transparent** (RGBA, ou palette avec transparence),
de moins de 300 Ko, dans `public/emotes/`. Le nom du fichier devient son identifiant : minuscules, chiffres, `-` et `_`
uniquement (ex. `belote.png`). Le libelle et l'ordre d'affichage se reglent dans `public/emotes/emotes.json`
(`{ "belote": "Belote !" }`). Verifier avec `npm run check-emotes`, puis committer : le serveur la prend en compte sans
redemarrage. Les emotes d'origine se regenerent avec `python3 tools/generate-emotes.py` (Pillow).

## IA : deux modes

- **Legacy** (`ai/coinche-bot.js`) : l'IA historique.
- **Regles** (`ai/rule-bot.js`) : pilotee par `ai/rules/rule_annonce.json` et `ai/rules/rule_jeux.json`,
  modifiables par commit (relus automatiquement, sans redemarrage). Documentation complete : [RULE.md](RULE.md) ;
  pour les agents IA : [RULE_AGENT.md](RULE_AGENT.md).
- Choix du mode dans la salle d'attente (menu « Type d'IA ») ou `/addia Nord rule`.
- `/debug rule` dans le chat : nombre de regles valides / invalides et detail des erreurs.
- `npm run compare-ai` : compare les deux IA sur des donnes identiques.

## IA : logique des appels

Convention utilisee par l'IA (et reconnue quand un humain la pratique) :

- **Faire un appel** : lors de sa *premiere defausse* de la manche (on ne fournit pas la couleur
  demandee et on ne coupe pas), jeter une **petite carte** (7, 8, 9... valeur 0) d'une couleur
  indique au partenaire qu'on y est **maitre**. L'IA appelle dans une couleur ou elle detient la
  carte maitresse et au moins une petite carte.
- **Repondre a un appel** : quand le partenaire a appele, l'IA qui prend la main rejoue cette
  couleur par sa plus petite carte (sauf si un adversaire chicane peut couper, ou si l'attaque
  est encore en train de faire tomber les atouts).
- **Lire les appels adverses** : l'IA evite d'entamer une couleur ou un adversaire a appele.
- Un appel est consomme des que la couleur est rejouee.

## Structure du projet

```text
.
|-- game.js               # Moteur de jeu (regles, scoring, etats)
|-- server.js             # Serveur Express + Socket.IO
|-- ai/coinche-bot.js     # IA serveur (encheres, jeu de la carte, appels)
|-- test/run-tests.js     # Tests de non-regression (regles + IA), sans dependance
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
- `npm test`: lance tous les tests (regles, IA, serveur, noms d'equipe, statistiques, emotes).
- `npm run check-emotes`: verifie les emotes de `public/emotes/`.

## Personnalisation rapide

- Regles/scoring: `game.js`
- Interface/layout: `public/style.css` et `public/index.html`
- Logique client temps reel: `public/game-client.js`

## Roadmap (idee)

- Parties publiques avec liste de salles.
- Reconnexion automatique en cas de perte reseau.

