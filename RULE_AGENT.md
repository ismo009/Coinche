# RULE_AGENT.md — l'IA à règles, pour agents IA

Ce document s'adresse aux agents (LLM, assistants de code) qui modifient l'IA à règles de Cari'Coinche. Pour le format des règles côté utilisateur, la référence est [RULE.md](RULE.md) ; ce fichier décrit l'architecture, les invariants et la marche à suivre.

## 1. Vue d'ensemble

```
server.js ── runBotTurn(roomId)
   │  player.aiMode === 'rule' ? ai/rule-bot.js : ai/coinche-bot.js (legacy)
   ▼
ai/rule-bot.js            construit le CONTEXTE (valeurs + fonctions) d'une décision
   │  chooseBid(game) / chooseCard(game, position)
   ▼
ai/rules/engine.js        charge, valide, met en cache et EXÉCUTE les règles
   │  getRuleSet(kind), runAnnonce(set, ctx), runJeu(set, ctx), buildReport()
   ▼
ai/rules/expression.js    langage d'expressions : tokenize → parse (Pratt) → validate (types) → evaluate
ai/rules/schema.js        LISTE OFFICIELLE des identifiants / champs / fonctions disponibles et de leurs types
ai/rules/rule_annonce.json, ai/rules/rule_jeux.json   les règles (données)
```

- `game.js` applique les règles du jeu ; les règles JSON ne choisissent **que parmi les coups légaux**.
- L'IA legacy (`ai/coinche-bot.js`) est **figée** : ne pas modifier son comportement. Elle exporte des fonctions internes dans `helpers` (évaluations de main, simulation, appels) réutilisées par `rule-bot.js`.
- Le mode d'une IA est stocké dans `game.players[pos].aiMode` (`'legacy'` | `'rule'`) et exposé au client dans `state.players[pos].ai`.

## 2. Cycle d'une décision

**Annonce** (`chooseBid`) :

1. `engine.getRuleSet('annonce')` : relit le fichier si son `mtime` a changé (rechargement à chaud), sinon cache.
2. `buildAnnonceContext(game)` → `{ values, functions, isLegal(action), normalizeBid(points) }`.
3. `engine.runAnnonce(set, ctx)` : calcule `vars`, parcourt `set.ordered` (règles valides et actives, priorité décroissante puis ordre du fichier) ; renvoie la première règle dont `when` est vrai et dont l'action est légale.
4. Aucune règle : `pass`. Exception JS : repli sur `legacy.chooseBid`.

**Jeu** (`chooseCard`) :

1. Une seule carte jouable : jouée directement, sans règle.
2. `buildJeuContext(game, position, samples)` → `{ values, functions, candidates, cardValue }`. Chaque carte est une *vue* (`makeView`) : champs statiques + champs probabilistes définis par **getters paresseux** (la simulation n'est lancée que si une règle lit `card.ev`, `card.pWin`, `pGain(...)`...).
3. `engine.runJeu` : `restrict` / `exclude` filtrent (jamais jusqu'à vide), `play` décide immédiatement, `score` additionne ; à la fin, score maximal puis `final.tieBreak`.
4. Exception JS : repli sur `legacy.chooseCard`.

`ruleBot.lastDecision` garde la dernière règle décisive (`ruleId` = id, `'score'`, `'legacy'`) : utile pour déboguer.

## 3. Invariants à respecter

1. **Aucune exécution de code** depuis les JSON : pas d'`eval`, pas de `Function`, pas d'accès aux prototypes (`__proto__`, `constructor`, `prototype` sont refusés). Les fonctions appelables sont uniquement celles de `GENERIC_FUNCTIONS` (expression.js) et de `schema.js`.
2. **Schéma = implémentation** : tout identifiant, champ ou fonction ajouté au contexte dans `rule-bot.js` doit être déclaré dans `schema.js` (sinon les règles qui l'utilisent sont invalides), et inversement. Toute modification doit être reportée dans **RULE.md** (sections 7 et 8).
3. **Ids uniques sur les deux fichiers** ; une règle en double est invalide (`buildReport`).
4. **Ne jamais bloquer une partie** : toute erreur d'exécution d'une règle est capturée (`noteRuntimeError`), la règle est ignorée, et la décision retombe sur une valeur sûre. Côté serveur, une annonce refusée devient `pass` et une carte refusée devient la première carte jouable.
5. **Une règle invalide n'est jamais exécutée** (filtrée de `set.ordered`).
6. Les valeurs exposées aux règles sont des **données simples** (objets, listes, nombres, textes). Ne pas exposer d'objets du moteur (`game`, sockets...).
7. Les fichiers livrés doivent rester **100 % valides** (`npm test` le vérifie).

## 4. Ajouter une variable, un champ de carte ou une fonction

Exemple : exposer `trick.highestTrump` (rang de l'atout le plus fort du pli).

1. `ai/rule-bot.js`, dans `buildJeuContext`, ajouter la valeur dans `values.trick`.
2. `ai/rules/schema.js`, ajouter `highestTrump: rankEnum` dans `JEU_IDENTIFIERS.trick` (les énumérations permettent de détecter les comparaisons avec une valeur impossible).
3. `RULE.md`, ajouter une ligne au tableau 8.1.
4. Ajouter un test si la valeur a une logique non triviale (`test/run-tests.js`).

Pour une **fonction** : implémentation dans `functions` (rule-bot.js) + déclaration `T.func(minArgs, maxArgs, typeRetour, { args: [types] })` dans `schema.js`. Les `args` de type énumération valident les littéraux (`hasCard('ass', ...)` sera refusé).

Pour un **champ probabiliste** : l'ajouter à l'objet renvoyé par `simulate(card)`, à la liste des getters paresseux de `makeView`, et à `PLAY_CARD` dans `schema.js`.

## 5. Modifier les règles (fine-tuning)

- Les règles livrées portent `"source": "legacy"` quand elles reproduisent l'ancienne IA, `"convention"` pour une convention de jeu ajoutée, `"exemple"` pour des exemples désactivés.
- Préférer **modifier un paramètre** (`params`) plutôt qu'un nombre en dur.
- Pour remplacer une règle : en créer une nouvelle (nouvel id), désactiver l'ancienne avec `"enabled": false`.
- Priorités (convention des fichiers livrés) : `play` / filtres ≥ 850, score de base 500, bonus/malus 200-499, exemples variables.
- Après modification : `npm test`, puis `npm run compare-ai` (≥ 200 paires ; une différence < 2 erreurs types n'est pas significative). Les parties sont stochastiques : ne jamais conclure sur quelques parties.

## 6. Valider et tester

```bash
npm test                                   # règles + IA + serveur (dont : fichiers livrés 100 % valides)
node -e "const e=require('./ai/rules/engine');console.log(e.formatReportLines(e.buildReport({reload:true})).join('\n'))"
npm run compare-ai                         # IA règles vs legacy, donnes identiques, équipes échangées
```

- `buildReport({ files: { annonce, jeux } })` valide des fichiers arbitraires sans toucher au cache (utilisé par les tests).
- En jeu : `/debug rule` (relit les fichiers, affiche « N rules - V valides - I invalides » puis une ligne par règle invalide).

## 7. Points d'attention

- **Coût** : chaque lecture d'un champ probabiliste d'une nouvelle carte lance `simulation.samples` simulations de fin de pli. Une règle `score` qui lit `card.ev` sur toutes les candidates multiplie le coût par le nombre de candidates. Garder `samples` raisonnable (48 par défaut) : le serveur tourne sur des machines modestes.
- **Sémantique de `play`** : décision immédiate, les règles de priorité inférieure ne sont pas évaluées. Un `restrict` de priorité inférieure à un `play` n'a donc aucun effet sur ce `play`.
- **`vars`** : calculées avant les règles, sans accès à `card` ; une variable invalide rend invalides les règles qui l'utilisent.
- **`null`** : `trump` vaut `null` en tout atout / sans atout, `trick.ledSuit` vaut `null` quand on entame. `card.isTrump` est vrai pour toutes les cartes en tout atout.
- **Textes dans le JSON** : une couleur littérale s'écrit avec apostrophes à l'intérieur de la chaîne JSON : `"suit": "'coeur'"`.
- **Appels** : `legacy.analyzeSignals` interprète la première défausse faible de chaque joueur comme un appel ; c'est la même lecture pour humains et IA.
- Le site https://www.belote.com/regles-et-variantes/regle-belote-coinche/ n'est pas lisible automatiquement (protection anti-robots) : ne pas tenter de contourner cette protection.

## 8. Fichiers

| Fichier | Rôle |
| --- | --- |
| `ai/rules/expression.js` | langage d'expressions (parse, validation typée, évaluation bornée à 200 000 étapes) |
| `ai/rules/schema.js` | identifiants, champs, fonctions et leurs types |
| `ai/rules/engine.js` | chargement / validation / cache / rapport / exécution |
| `ai/rule-bot.js` | contextes annonce et jeu, simulation Monte-Carlo, repli legacy |
| `ai/rules/rule_annonce.json`, `ai/rules/rule_jeux.json` | règles |
| `ai/coinche-bot.js` | IA legacy (figée) + `helpers` |
| `server.js` | modes d'IA (`AI_MODES`), `/addia ... [legacy\|rule]`, `/debug rule`, replis de sécurité |
| `public/index.html`, `public/game-client.js` | menu « Type d'IA » dans la salle d'attente |
| `tools/compare-ai.js` | comparaison statistique règles vs legacy |
| `test/run-tests.js`, `test/server-robustness.js` | tests |
