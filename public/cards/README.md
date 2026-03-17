# Textures de cartes

Ce projet rend les cartes en HTML/CSS (pas en images) par defaut.

Si tu veux utiliser tes propres textures (images locales), tu dois **les servir** via le serveur web (sinon les autres joueurs ne pourront pas les voir, et les chemins `C:\...` / `file://` sont generalement bloques par le navigateur).

## Ou mettre les fichiers

Copie tes images dans ce dossier :

- `public/cards/`

Comme `server.js` fait `express.static(public)`, ces fichiers seront accessibles dans le navigateur a :

- `http://localhost:3000/cards/...`

## Convention de nommage (actuelle)

- Dos de carte : `public/cards/BACK.png`
- Faces : `public/cards/<RANG>_<COULEUR>.png`

Avec :

- `RANG` : `SEPT`, `HUIT`, `NEUF`, `DIX`, `VALET`, `DAME`, `ROI`, `AS`
- `COULEUR` : `COEUR`, `CARREAU`, `TREFLE`, `PIC`

Exemples :

- `public/cards/AS_PIC.png`
- `public/cards/DIX_CARREAU.png`
- `public/cards/VALET_COEUR.png`

## Activer les textures

Dans `public/game-client.js`, passe `CARD_TEXTURES.enabled` a `true`.

Si tes fichiers ont une autre convention, adapte `getCardTextureUrl()` dans le meme fichier.
