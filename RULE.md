# IA à règles — guide complet

Cari'Coinche propose deux IA :

| Mode | Fichiers | Description |
| --- | --- | --- |
| **Legacy** | `ai/coinche-bot.js` | L'IA historique, codée en JavaScript. Inchangée. |
| **Règles** | `ai/rules/rule_annonce.json` + `ai/rules/rule_jeux.json` | L'IA pilotée par des règles écrites en JSON, modifiables par simple commit GitHub. |

Les annonces du mode « règles » peuvent ouvrir à 80 avec une main risquée mais suffisamment prometteuse pour appeler le partenaire. Elles n'ajoutent pas de points à l'estimation des contrats ; l'IA legacy reste inchangée.

Sommaire :

1. [Utilisation en jeu](#1-utilisation-en-jeu)
2. [Cycle de modification](#2-cycle-de-modification)
3. [Structure d'un fichier de règles](#3-structure-dun-fichier-de-règles)
4. [Structure d'une règle](#4-structure-dune-règle)
5. [Comment les règles sont évaluées](#5-comment-les-règles-sont-évaluées)
6. [Le langage d'expressions](#6-le-langage-dexpressions)
7. [Annonces : variables et fonctions](#7-annonces--variables-et-fonctions-rule_annoncejson)
8. [Jeu de la carte : variables et fonctions](#8-jeu-de-la-carte--variables-et-fonctions-rule_jeuxjson)
9. [Espérances, probabilités et coûts](#9-espérances-probabilités-et-coûts)
10. [Recettes](#10-recettes)
11. [`/debug rule` et messages d'erreur](#11-debug-rule-et-messages-derreur)
12. [Rappel des règles de la coinche utilisées](#12-rappel-des-règles-de-la-coinche-utilisées)

---

## 1. Utilisation en jeu

- **Ajouter une IA** : dans la salle d'attente, choisir le **Type d'IA** (`Legacy` ou `Règles`) dans le menu déroulant, puis cliquer sur *Ajouter une IA*. Le choix est mémorisé.
- **Commande de chat** : `/addia Nord rule` (ou `legacy`, valeur par défaut) ajoute une IA sur une position précise.
- **Comparer les deux IA** : créer une partie avec 2 IA legacy contre 2 IA règles. Le créateur occupe une place : par exemple, s'asseoir en Nord, puis `/addia Sud legacy`, `/addia Est rule`, `/addia Ouest rule` (on joue alors avec une IA legacy contre deux IA règles). Pour une comparaison sans joueur humain, utiliser l'outil ci-dessous.
- **Comparaison statistique** : `npm run compare-ai` fait jouer l'IA règles contre l'IA legacy sur les mêmes donnes (équipes échangées) et affiche l'écart moyen de points avec son erreur type. `node tools/compare-ai.js 500` pour 500 paires.
- **Vérifier les fichiers** : `/debug rule` dans le chat (voir [section 11](#11-debug-rule-et-messages-derreur)).

Les IA règles s'appellent « IA Règles » et les IA legacy « IA Legacy ».

**Sécurité de fonctionnement** : si un fichier de règles est illisible, ou si aucune règle ne s'applique, l'IA règles retombe sur une décision sûre (passer à l'annonce, ou la décision de l'IA legacy au jeu). Une partie n'est jamais bloquée par une règle invalide : la règle invalide est simplement ignorée.

## 2. Cycle de modification

1. Modifier `ai/rules/rule_annonce.json` ou `ai/rules/rule_jeux.json` (sur GitHub ou en local).
2. Commit + push, puis `git pull` sur le serveur. **Pas besoin de redémarrer** : les fichiers sont relus automatiquement dès qu'ils changent sur le disque.
3. Taper `/debug rule` dans le chat d'une partie : le serveur relit les fichiers et affiche les règles invalides.
4. Lancer `npm test` (vérifie notamment que tous les fichiers livrés sont valides) et `npm run compare-ai` pour mesurer l'effet du changement.

Conseils :

- **Un identifiant (`id`) ne doit jamais être réutilisé**, même dans l'autre fichier. Pour supprimer une règle, préférez `"enabled": false` (l'historique reste lisible).
- Changez **un seul paramètre à la fois** et mesurez avec `npm run compare-ai` (au moins 200 paires). Un écart inférieur à 2 erreurs types n'est pas significatif.
- Les valeurs numériques à régler doivent de préférence aller dans `params` : elles sont nommées, documentées par leur nom, et utilisables par plusieurs règles.

## 3. Structure d'un fichier de règles

```json
{
  "version": 1,
  "description": "Texte libre",
  "params": { "openMin": 80, "riskyOpenMinEstimate": 15, "coincheEnemyStrength": 0.32 },
  "vars": [
    { "name": "best", "expr": "bestValue()" }
  ],
  "rules": [ ... ],

  "simulation": { "samples": 48 },
  "final": { "tieBreak": "lowest" }
}
```

| Clé | Fichier | Obligatoire | Rôle |
| --- | --- | --- | --- |
| `version` | les deux | non | Numéro de version du format (actuellement 1). |
| `description` | les deux | non | Texte libre. |
| `params` | les deux | non | Constantes réglables : nombre, booléen ou texte. Accessibles par `params.nom`. Nom : lettres, chiffres, `_`. |
| `vars` | les deux | non | Variables calculées **une fois par décision**, dans l'ordre de la liste. Chaque entrée : `{ "name": "...", "expr": "..." }`. Une variable peut utiliser `params`, les variables du contexte et les variables définies **avant** elle. Elle s'utilise ensuite directement par son nom (`best`, pas `vars.best`). Les variables ne peuvent pas utiliser `card`. |
| `rules` | les deux | **oui** | Liste des règles (section 4). |
| `simulation.samples` | jeux | non | Nombre de tirages de la simulation Monte-Carlo par carte (défaut 48, entre 4 et 400). Plus = plus précis mais plus lent. |
| `final.tieBreak` | jeux | non | Départage des cartes à égalité de score : `lowest` (défaut, la carte la moins chère), `highest`, ou `evNet` (meilleure espérance). |

Une variable invalide est signalée par `/debug rule` ; les règles qui l'utilisent deviennent alors invalides (« identifiant inconnu »).

Dans `rule_annonce.json`, `riskyOpenMinEstimate` fixe l'évaluation brute minimale d'une couleur pour qu'une main trop faible pour l'ouverture habituelle puisse tenter une annonce à 80. Cette prise de risque ne modifie pas l'estimation ni ne gonfle le niveau annoncé ; elle s'applique uniquement à l'ouverture sans enchère préalable. La valeur `0` désactive cette ouverture risquée.

## 4. Structure d'une règle

```json
{
  "id": 1,
  "name": "Coincher un contrat adverse trop ambitieux",
  "description": "Pourquoi et comment",
  "source": "legacy",
  "enabled": true,
  "priority": 100,
  "when": "canCoinche && defenseEffective - requiredDefense >= coincheMarginNeeded",
  "action": { "type": "coinche" }
}
```

| Clé | Obligatoire | Rôle |
| --- | --- | --- |
| `id` | **oui** | Entier positif **unique dans les deux fichiers**. C'est lui qu'affiche `/debug rule`. |
| `name` | non | Titre court. |
| `description` | non | Explication libre (fortement recommandée). |
| `source` | non | Origine : `legacy` (reproduit l'ancienne IA), `convention` (convention de jeu), `regle` (règle du jeu), `exemple`... Texte libre. |
| `tags`, `note` | non | Texte libre (classement, remarques). |
| `enabled` | non | `false` pour désactiver la règle sans la supprimer (défaut `true`). |
| `priority` | non | Nombre (défaut 0). **Les règles sont évaluées par priorité décroissante**, puis dans l'ordre du fichier à priorité égale. |
| `when` | non | Condition (expression). Si absente, la règle s'applique toujours. |
| `action` | **oui** | Ce que fait la règle (sections 5.1 et 5.2). |

Toute autre clé rend la règle invalide (cela évite les fautes de frappe silencieuses, ex. `"prority"`).

## 5. Comment les règles sont évaluées

### 5.1 Annonces (`rule_annonce.json`)

À son tour de parole, l'IA :

1. calcule les `vars` ;
2. parcourt les règles actives par **priorité décroissante** ;
3. prend **la première** règle dont `when` est vrai **et** dont l'action est légale à ce moment ;
4. si aucune règle ne convient : elle **passe**.

Actions possibles :

| Action | Champs | Légale quand |
| --- | --- | --- |
| `{ "type": "pass" }` | — | toujours |
| `{ "type": "coinche" }` | — | `canCoinche` (contrat adverse, pas encore coinché) |
| `{ "type": "surcoinche" }` | — | `canSurcoinche` (notre contrat est coinché, pas encore surcoinché) |
| `{ "type": "bid", "points": "<expr>", "suit": "<expr>" }` | `points` : expression numérique ; `suit` : expression texte (`'coeur'`, `'carreau'`, `'trefle'`, `'pique'`, `'tout-atout'`, `'sans-atout'`) | `canBid` (pas de coinche en cours) et `points` > contrat actuel |

Normalisation de `points` : arrondi à la dizaine, plafonné à 160 ; valeurs spéciales 250 (capot), 270 (capot beloté), 500 (générale) ; une valeur < 80 rend l'action inutilisable (on passe à la règle suivante). **Attention** : `suit` est une *expression*, donc une couleur fixe s'écrit avec des guillemets à l'intérieur : `"suit": "'coeur'"`.

### 5.2 Jeu de la carte (`rule_jeux.json`)

Quand l'IA doit jouer et a plusieurs cartes jouables (les *candidates*) :

1. calcul des `vars` ;
2. parcours des règles actives par **priorité décroissante** ; pour chaque règle dont `when` est vrai :

| Action | Champs | Effet |
| --- | --- | --- |
| `restrict` | `cards` (condition sur `card`) | Ne garde que les candidates qui vérifient `cards`. **Ignorée si aucune ne vérifie** (on ne se retrouve jamais sans carte). |
| `exclude` | `cards` | Retire les candidates qui vérifient `cards`. Ignorée si elle retirerait tout. |
| `play` | `cards` (optionnel), `pick`, `by` | **Décision immédiate** : parmi les candidates qui vérifient `cards`, joue celle choisie par `pick`. Si aucune ne vérifie `cards`, la règle est ignorée et on continue. |
| `score` | `cards` (optionnel), `value` | Ajoute `value` (expression numérique, calculée pour chaque carte) au score des candidates qui vérifient `cards`. Les scores s'additionnent d'une règle à l'autre. |

3. s'il n'y a pas eu de `play`, la carte qui a **le plus grand score total** est jouée (départage : `final.tieBreak`).

Valeurs de `pick` :

| `pick` | Choix |
| --- | --- |
| `lowest` (défaut) | la carte la « moins chère » : moins de points, puis la plus faible |
| `highest` | la carte la plus chère / la plus forte |
| `max` | la carte qui maximise l'expression `by` |
| `min` | la carte qui minimise l'expression `by` |
| `first` | la première candidate (ordre de la main) |

Dans `cards`, `value` et `by`, la variable **`card`** désigne la carte candidate évaluée (voir [8.2](#82-champs-de-card)).

Bonnes pratiques d'organisation (celle des fichiers livrés) :

- priorités ≥ 900 : décisions et filtres forts (`play`, `restrict`, `exclude`) ;
- priorité 500 : le score de base (espérance du pli) ;
- priorités < 500 : bonus / malus `score`.

Comme un `play` arrête tout, placez les `restrict`/`exclude` qui doivent s'appliquer avant lui à une priorité plus haute.

## 6. Le langage d'expressions

Les conditions et calculs s'écrivent comme en JavaScript simplifié. Rien n'est exécuté avec `eval` : les expressions sont analysées et vérifiées avant usage.

### 6.1 Valeurs

| Écriture | Type |
| --- | --- |
| `12`, `0.5` | nombre |
| `'coeur'` ou `"coeur"` | texte (dans le JSON, préférez les apostrophes : `"when": "trump == 'coeur'"`) |
| `true`, `false` | booléen |
| `null` | absence de valeur |
| `['as', '10']` | liste |

### 6.2 Opérateurs (du moins prioritaire au plus prioritaire)

| Opérateurs | Sens |
| --- | --- |
| `a ? b : c` | si `a` alors `b` sinon `c` |
| `||`, `or` | ou |
| `&&`, `and` | et |
| `==`, `!=` | égal, différent (deux cartes sont égales si même rang et même couleur) |
| `<`, `<=`, `>`, `>=`, `in` | comparaisons ; `x in [a, b]` vrai si `x` est dans la liste |
| `+`, `-` | addition, soustraction (`+` concatène si l'un des deux est un texte) |
| `*`, `/`, `%` | multiplication, division, modulo (**division par 0 = 0**) |
| `!`, `not`, `-x` | négation logique, opposé |
| `a.b`, `f(x)`, `l[0]` | champ, appel de fonction, élément de liste |

Parenthèses autorisées. Les nombres non définis valent 0 dans les calculs ; un champ absent vaut `null` (lire `x.y` sur `null` donne `null`, sans erreur).

### 6.3 Fonctions fléchées

Certaines fonctions prennent une fonction en argument : `x => expression`.

```
count(hand, c => c.suit == trump)                 // nombre d'atouts en main
any(playable, c => c.isTrump && c.isMaster)       // ai-je un atout maître jouable ?
sum(trick.cards, c => c.points)                   // points déjà dans le pli
maxBy(playable, c => c.ev)                        // la carte jouable de meilleure espérance
```

Le paramètre (`c`) n'existe que dans l'expression fléchée. Une fonction fléchée n'est permise qu'en argument de fonction.

### 6.4 Fonctions génériques (disponibles partout)

| Fonction | Résultat |
| --- | --- |
| `count(liste)` / `count(liste, x => cond)` | nombre d'éléments (qui vérifient `cond`) |
| `any(liste, x => cond)` | vrai si au moins un élément vérifie `cond` |
| `all(liste, x => cond)` | vrai si tous les éléments vérifient `cond` |
| `none(liste, x => cond)` | vrai si aucun élément ne vérifie `cond` |
| `sum(liste)` / `sum(liste, x => valeur)` | somme |
| `avg(liste)` / `avg(liste, x => valeur)` | moyenne (0 si liste vide) |
| `filter(liste, x => cond)` | sous-liste |
| `first(liste)` / `first(liste, x => cond)` | premier élément (qui vérifie `cond`), ou `null` |
| `last(liste)` / `last(liste, x => cond)` | dernier élément, ou `null` |
| `minBy(liste, x => valeur)` / `maxBy(...)` | élément qui minimise / maximise `valeur` |
| `len(liste)` | longueur (aussi `liste.length`) |
| `contains(liste, valeur)` | vrai si `valeur` est dans la liste |
| `min(a, b, ...)` / `max(a, b, ...)` | minimum / maximum (accepte aussi une liste) |
| `abs(x)`, `floor(x)`, `ceil(x)` | valeur absolue, partie entière inférieure / supérieure |
| `round(x)` / `round(x, n)` | arrondi (à `n` décimales) |
| `roundTo10(x)` | arrondi à la dizaine |
| `clamp(x, min, max)` | borne `x` entre `min` et `max` |
| `binom(n, k)` | coefficient binomial C(n, k) |
| `pAtLeastOne(population, succès, tirés)` | probabilité de tirer au moins un « succès » en tirant `tirés` cartes parmi `population` contenant `succès` cartes favorables (loi hypergéométrique) |
| `pExactly(population, succès, tirés, k)` | probabilité d'en tirer exactement `k` |
| `pAtLeast(population, succès, tirés, k)` | probabilité d'en tirer au moins `k` |

Exemple : probabilité que les adversaires (16 cartes inconnues sur 24 au moment des annonces) aient au moins un des 2 valets qui me manquent : `pAtLeastOne(24, 2, 16)`.

## 7. Annonces : variables et fonctions (`rule_annonce.json`)

« nous » = l'IA et son partenaire. Les couleurs s'écrivent `'coeur'`, `'carreau'`, `'trefle'`, `'pique'` ; les contrats peuvent aussi être `'tout-atout'` et `'sans-atout'`. Les positions : `'sud'`, `'ouest'`, `'nord'`, `'est'`.

### 7.1 Variables

| Variable | Type | Sens |
| --- | --- | --- |
| `me.position` | position | ma place |
| `me.team` | `'ns'` / `'eo'` | mon équipe |
| `partner` | position | place de mon partenaire |
| `dealer` | position | donneur |
| `speaker` | nombre 1-4 | mon rang de parole dans le tour (1 = premier à parler) |
| `turn` | nombre | combien de fois j'ai déjà parlé + 1 |
| `hand` | liste de cartes | ma main (`rank`, `suit`, `points` = 0 aux annonces) |
| `current.points` | nombre | contrat actuel (0 si aucune enchère) |
| `current.suit` | couleur | couleur du contrat actuel (`null` si aucun) |
| `current.by` | `'me'`, `'partner'`, `'opponent'`, `'none'` | auteur du contrat actuel |
| `current.team` | `'us'`, `'them'`, `'none'` | équipe du contrat actuel |
| `coinched` | booléen | le contrat est coinché |
| `surcoinched` | booléen | le contrat est surcoinché |
| `canBid` | booléen | une enchère est encore possible (pas de coinche) |
| `canCoinche` | booléen | je peux coincher (contrat adverse non coinché) |
| `canSurcoinche` | booléen | je peux surcoincher |
| `minBid` | nombre | plus petite enchère légale (80 si aucune enchère, 0 si plus rien) |
| `partnerBid.exists`, `.points`, `.suit` | | dernière enchère de mon partenaire |
| `opponentBid.exists`, `.points`, `.suit` | | dernière enchère d'un adversaire |
| `myBid.exists`, `.points`, `.suit` | | ma dernière enchère |
| `bids` | liste | historique : chaque élément a `who` (`'me'`, `'partner'`, `'opponent'`), `type` (`'bid'`, `'pass'`, `'coinche'`, `'surcoinche'`), `points`, `suit` |
| `passes` | nombre | passes consécutives depuis la dernière annonce |
| `score.us`, `score.them`, `score.target` | nombres | score de la partie et objectif (2000) |
| `params.xxx` | | paramètres du fichier |

### 7.2 Fonctions

| Fonction | Résultat |
| --- | --- |
| `estimate(couleur)` | estimation de l'IA legacy des points jouables dans ce contrat (couleur, `'tout-atout'` ou `'sans-atout'`), déjà ramenée aux paliers d'enchère (0 si < 80) |
| `specialRisk(couleur)` | malus de risque legacy pour TA / SA (adversaires qui tiennent les valets / as, ouverture adverse) ; 0 pour une couleur |
| `bestSuit()` | contrat qui maximise `estimate - specialRisk` |
| `bestValue()` | valeur (en paliers) de ce meilleur contrat |
| `countSuit(couleur)` | nombre de cartes de la couleur en main |
| `countRank(rang)` | nombre de cartes de ce rang (`'as'`, `'10'`, `'valet'`, `'9'`...) |
| `has(rang, couleur)` | vrai si j'ai la carte |
| `hasBelote(couleur)` | vrai si j'ai roi + dame de la couleur |
| `defensePotential(contrat)` | points que ma main peut apporter en défense contre ce contrat (heuristique legacy) |
| `opponentBeloteRisk(contrat, points)` | malus attendu pour une belote adverse (0 si j'ai le roi ou la dame d'atout) |
| `partnerRaiseAllowed()` | vrai si je peux soutenir l'enchère couleur du partenaire (pas de double soutien sans intervention adverse) ; la règle livrée bloque aussi un second soutien si l'IA a déjà annoncé cette couleur |
| `partnerRaise(couleur, points)` | montée proposée par la règle legacy : valet +20, 9 +10, as +10 (contrats ≥ 100), belote +20 |
| `relayOvercalled()` | vrai si une couleur relayée par mon partenaire a été surenchérie par l'adversaire |
| `reclaimBid()` / `reclaimSuit()` | reprise minimale (+10) proposée par la règle legacy, et sa couleur (0 / `null` si non conseillée) |
| `bidStep(x)` | normalise `x` en palier d'enchère valide (0 si < 80) |

## 8. Jeu de la carte : variables et fonctions (`rule_jeux.json`)

### 8.1 Variables

| Variable | Type | Sens |
| --- | --- | --- |
| `me.position`, `me.team`, `partner` | | comme aux annonces |
| `role` | `'attack'` / `'defense'` | attaque = équipe qui a le contrat |
| `trump` | couleur | couleur d'atout (`null` en tout atout / sans atout) |
| `contract.points`, `contract.suit` | | contrat |
| `contract.type` | `'couleur'`, `'tout-atout'`, `'sans-atout'` | type de contrat |
| `contract.coinched`, `.surcoinched` | booléens | |
| `contract.byMe`, `.byPartner` | booléens | qui a pris |
| `contract.special` | booléen | capot / générale (≥ 250) |
| `trick.number` | 1 à 8 | numéro du pli |
| `trick.size` | 0 à 3 | cartes déjà posées dans le pli |
| `trick.position` | 1 à 4 | ma position dans le pli (1 = j'entame) |
| `trick.leading` | booléen | j'entame |
| `trick.ledSuit` | couleur | couleur demandée (`null` si j'entame) |
| `trick.points` | nombre | points déjà dans le pli |
| `trick.winner` | `'me'`, `'partner'`, `'opponent'`, `'none'` | qui gagne le pli pour l'instant |
| `trick.partnerMaster` / `trick.opponentMaster` | booléens | |
| `trick.cut` | booléen | quelqu'un a coupé (atout sur une couleur non atout) |
| `trick.isLast` | booléen | dernier pli (vaut 10 points de plus : « 10 de der ») |
| `trick.remaining` | 0 à 3 | joueurs qui jouent après moi |
| `trick.lastWinner` | `'us'`, `'them'`, `'none'` | équipe qui a remporté le pli précédent |
| `trick.cards` | liste | cartes du pli (`rank`, `suit`, `points`) |
| `hand` | liste de cartes | ma main (champs complets, voir 8.2) |
| `playable` | liste de cartes | mes cartes jouables (avant `restrict` / `exclude`) |
| `played` | liste | cartes déjà jouées cette manche |
| `unseen` | liste | cartes que je n'ai jamais vues (ni en main, ni jouées) |
| `trumps.mine` | nombre | mes atouts |
| `trumps.played` | nombre | atouts déjà tombés |
| `trumps.unseen` | nombre | atouts ni en main ni tombés |
| `trumps.enemyEstimate` | nombre | estimation des atouts restant aux adversaires |
| `trumps.opponentsOut` | booléen | les deux adversaires n'ont certainement plus d'atout |
| `signals.partnerSuit` | couleur | couleur appelée par mon partenaire, encore active (`null` sinon) |
| `signals.opponentSuits` | liste | couleurs appelées par les adversaires, encore actives |
| `signals.myFirstDiscard` | booléen | je peux défausser et je n'ai encore jamais défaussé (=> ma défausse sera lue comme un appel) |
| `signals.discardAvailable` | booléen | une défausse est possible (je n'ai pas la couleur demandée) |
| `score.us`, `.them`, `.roundUs`, `.roundThem`, `.target` | nombres | scores de la partie et de la manche |
| `params.xxx` | | paramètres du fichier |

### 8.2 Champs de `card`

Disponibles pour `card` (dans `cards`, `value`, `by`) et pour les éléments de `hand` / `playable`.

| Champ | Sens |
| --- | --- |
| `rank`, `suit` | rang (`'7'`, `'8'`, `'9'`, `'10'`, `'valet'`, `'dame'`, `'roi'`, `'as'`) et couleur |
| `isTrump` | carte d'atout (toutes en tout atout, aucune en sans atout) |
| `points` | valeur en points dans ce contrat |
| `order` | force dans sa couleur (0 = la plus faible, 7 = la plus forte) |
| `power` | force globale (les atouts valent 100 + `order` en contrat couleur) |
| `isMaster` | aucune carte plus forte de la même couleur n'est encore dehors |
| `unseenStronger` | nombre de cartes plus fortes de la couleur encore dehors |
| `isLowestInSuit` / `isHighestInSuit` | plus petite / plus grande de ma main dans sa couleur |
| `suitCount` | nombre de cartes de cette couleur dans ma main (elle comprise) |
| `isLed` | de la couleur demandée |
| `isDiscard` | ce serait une défausse (ni la couleur demandée, ni un atout) |
| `winsNow` | gagnerait le pli si personne ne jouait après moi |
| `risk` | coût de la carte (heuristique legacy : points + bonus pour les as, 10, valet et 9 d'atout) |
| `isLowSignal` | petite carte (valeur 0, hors atout) utilisable pour un appel |
| `ev`, `evNet`, `evLoss`, `pWin`, `pWinMe`, `pLose`, `pCut`, `pOvertrumped` | probabilités et espérances (section 9) |

### 8.3 Fonctions

| Fonction | Résultat |
| --- | --- |
| `countSuit(couleur)` | nombre de cartes de la couleur en main |
| `hasCard(rang, couleur)` | j'ai cette carte |
| `isPlayed(rang, couleur)` | cette carte est déjà tombée |
| `unseenCount(couleur)` | cartes de la couleur ni en main ni tombées |
| `isVoid(qui, couleur)` | `qui` est connu pour ne plus avoir de la couleur (il n'a pas fourni). `qui` : `'partner'`, `'left'` (joue après moi), `'right'` (joue avant moi), `'anyOpponent'`, `'allOpponents'` |
| `opponentMayCut(couleur)` | un adversaire est connu chicane dans la couleur et peut encore avoir de l'atout |
| `lowestInHand(couleur)` / `highestInHand(couleur)` | ma plus petite / plus grande carte de la couleur (`null` si aucune) |
| `masterInHand(couleur)` | ma plus grande carte de la couleur est maîtresse |
| `pGain(card, n)` | probabilité que mon équipe gagne au moins `n` points sur ce pli si je joue `card` |
| `pLoss(card, n)` | probabilité que l'adversaire gagne au moins `n` points sur ce pli si je joue `card` |

## 9. Espérances, probabilités et coûts

Pour chaque carte jouable, l'IA peut **simuler** la fin du pli : elle distribue au hasard les cartes qu'elle ne connaît pas aux joueurs qui jouent après elle (en respectant les chicanes déjà connues), fait jouer chacun selon une heuristique simple, et recommence `simulation.samples` fois (48 par défaut). On obtient ainsi une **distribution** des résultats du pli pour cette carte.

Ces valeurs ne sont calculées **que si une règle les utilise** (le calcul a un coût).

| Valeur | Définition |
| --- | --- |
| `card.pWin` | probabilité que mon équipe remporte le pli |
| `card.pWinMe` | probabilité que je remporte le pli moi-même |
| `card.pLose` | `1 - pWin` |
| `card.ev` | espérance des points gagnés par mon équipe sur ce pli (0 si le pli est perdu) |
| `card.evLoss` | espérance des points donnés à l'adversaire |
| `card.evNet` | `ev - evLoss` |
| `card.pCut` | probabilité que le pli soit perdu parce qu'un adversaire a coupé (contrat couleur, couleur demandée non atout) |
| `card.pOvertrumped` | si je coupe : probabilité d'être surcoupé par un adversaire |
| `pGain(card, n)` | probabilité de gagner au moins `n` points sur le pli |
| `pLoss(card, n)` | probabilité de donner au moins `n` points à l'adversaire |

Les points comptés incluent les 10 points du dernier pli.

**Exemple : l'as.** J'entame l'as de pique en défense. La simulation donne par exemple :

- 30 % : un adversaire coupe → mon équipe gagne 0 point, l'adversaire empoche l'as et le reste (`pCut ≈ 0.30`) ;
- 45 % : le pli passe avec de petites cartes → au moins 11 points (`pGain(card, 11) ≈ 0.70`) ;
- 25 % : le 10 de pique tombe dessous → au moins 21 points (`pGain(card, 21) ≈ 0.25`).

On peut alors écrire :

```json
{
  "id": 500,
  "name": "Encaisser l'as s'il rapporte probablement 21 points",
  "when": "role == 'defense' && trick.leading",
  "action": {
    "type": "play",
    "cards": "card.rank == 'as' && !card.isTrump && pGain(card, 21) > 0.5 && card.pCut < 0.2",
    "pick": "max",
    "by": "card.ev"
  }
}
```

**Espérance moins coût.** Le score de base livré (règle 110) combine l'espérance et le coût :

```
card.evNet                                   // espérance nette du pli
+ 4 * card.pWinMe + 2 * (card.pWin - card.pWinMe) - 2 * card.pLose   // garder la main
- card.risk * (0.05 * card.pWin + 0.45 * card.pLose)                 // coût de la carte, surtout si le pli est perdu
```

Une carte forte (`risk` élevé) jouée dans un pli perdu coûte cher ; jouée dans un pli gagné, elle coûte peu. Toutes ces pondérations sont dans `params` et peuvent être réglées.

## 10. Recettes

**Ne jamais couper le partenaire maître quand on peut défausser :**
```json
{ "id": 600, "priority": 890,
  "when": "contract.type == 'couleur' && trick.partnerMaster && any(playable, c => !c.isTrump)",
  "action": { "type": "exclude", "cards": "card.isTrump" } }
```

**Dernier à jouer, partenaire sûr de gagner : charger le pli (donner des points) :**
```json
{ "id": 601, "priority": 300,
  "when": "trick.remaining == 0 && trick.partnerMaster",
  "action": { "type": "score", "cards": "!card.isTrump && !card.isMaster", "value": "card.points * 0.5" } }
```

**Garder un atout pour le 10 de der :**
```json
{ "id": 602, "priority": 280,
  "when": "role == 'attack' && trick.number >= 6 && trumps.mine == 1 && trumps.enemyEstimate > 0",
  "action": { "type": "score", "cards": "card.isTrump && trick.leading", "value": "-8" } }
```

**Ouvrir à 80 avec valet + 9 d'atout et au moins 3 atouts :**
```json
{ "id": 603, "priority": 72,
  "when": "current.points == 0 && any(['coeur','carreau','trefle','pique'], s => has('valet', s) && has('9', s) && countSuit(s) >= 3)",
  "action": { "type": "bid", "points": "80",
              "suit": "first(['coeur','carreau','trefle','pique'], s => has('valet', s) && has('9', s) && countSuit(s) >= 3)" } }
```

**Ne pas coincher quand on mène largement :**
```json
{ "id": 604, "priority": 101,
  "when": "canCoinche && score.us - score.them > 800",
  "action": { "type": "pass" } }
```
(priorité 101 > règle de coinche 100 : elle est examinée avant et passe.)

**Utiliser une probabilité de répartition aux annonces** (tout atout risqué s'il me manque des valets) :
```json
{ "id": 605, "priority": 69,
  "when": "current.points == 0 && bestSuit() == 'tout-atout' && pAtLeastOne(24, 4 - countRank('valet'), 16) > 0.9",
  "action": { "type": "pass" } }
```

## 11. `/debug rule` et messages d'erreur

Dans le chat d'une partie : **`/debug rule`**. Le serveur relit les deux fichiers et répond (à vous seul) :

```
231 rules - 229 valides - 2 invalides
rule 29 invalide (rule_annonce.json) : when : valeur 'eux' inconnue (valeurs possibles : us, them, none)
rule 146 invalide (rule_jeux.json) : action.value : champ inconnu 'pwin' (champs possibles : rank, suit, ...)
```

- Le total compte toutes les règles des deux fichiers (y compris désactivées) ; une ligne indique combien de règles valides sont désactivées.
- Les erreurs de fichier (JSON illisible, `vars` invalide...) sont listées par nom de fichier.
- Les erreurs survenues **pendant** une partie (rare) sont listées : `rule jeux:120 : erreur à l'exécution (3x) : ...`.
- Au-delà de 25 lignes, la suite est écrite dans la console du serveur.

Messages courants :

| Message | Cause / correction |
| --- | --- |
| `identifiant inconnu 'xyz'` | variable inexistante (faute de frappe, variable `vars` mal nommée ou invalide) |
| `identifiant inconnu 'coeur' : pour une valeur texte, écris 'coeur' entre guillemets` | il manque les apostrophes |
| `champ inconnu 'pwin' (champs possibles : ...)` | faute de frappe dans un champ (la casse compte : `pWin`) |
| `valeur 'atack' inconnue (valeurs possibles : attack, defense)` | comparaison avec une valeur qui n'existe pas |
| `fonction inconnue 'foo()'` / `foo() attend 2 argument(s)` | fonction inexistante ou mauvais nombre d'arguments |
| `fin d'expression inattendue`, `')' attendu` | erreur de syntaxe |
| `id 12 déjà utilisé (rule_annonce.json, règle n°3)` | identifiant en double (les ids sont uniques **sur les deux fichiers**) |
| `clé inconnue "prority"` | faute de frappe dans une clé de la règle |
| `action.by est requis avec pick "max"` | champ obligatoire manquant |
| `un nombre est attendu` | `points`, `value` ou `by` doit être numérique |
| `lecture impossible : Unexpected token ...` | le fichier n'est pas du JSON valide (virgule en trop, guillemet manquant) |

## 12. Rappel des règles de la coinche utilisées

Les règles de jeu sont appliquées par le moteur (`game.js`) ; les fichiers de règles ne décident que **des choix** de l'IA parmi les coups légaux.

- 32 cartes, 4 joueurs, Nord-Sud contre Est-Ouest ; distribution 3-2-3.
- Enchères : 80 à 160 par 10, capot (250), capot beloté (270), générale (500) ; couleurs, tout atout, sans atout. La coinche (×2) se fait par un adversaire à tout moment des enchères, la surcoinche (×3) par l'équipe coinchée. Une générale est entamée par celui qui l'a annoncée.
- Jeu : fournir la couleur demandée ; à l'atout, monter si possible ; sans la couleur, couper (et surcouper si possible), sauf si le partenaire est maître ; sans pouvoir surcouper, il faut tout de même pisser (sous-couper) ; en tout atout il faut monter dans la couleur demandée ; en sans atout, seulement fournir.
- Valeurs : atout V 20, 9 14, A 11, 10 10, R 4, D 3 ; hors atout A 11, 10 10, R 4, D 3, V 2 ; tout atout et sans atout ont leurs barèmes propres (voir `game.js`). Dernier pli +10, belote-rebelote +20.

Les conventions utilisées pour pré-remplir les fichiers (faire tomber les atouts quand on a pris, ne pas couper le partenaire maître, appels par petite défausse, défausse dans les couleurs courtes, ne pas entamer atout en défense, garder les maîtresses) sont des conventions courantes de la belote coinchée. La page de référence https://www.belote.com/regles-et-variantes/regle-belote-coinche/ n'a pas pu être lue automatiquement (le site refuse les accès non humains) : ces règles pourront être affinées à partir de cette page.
