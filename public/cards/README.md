# Textures de cartes

Ce projet rend les cartes en HTML/CSS (pas en images) par defaut.

Si tu veux utiliser tes propres textures (images locales), elles doivent etre servies par le serveur web (pas de chemin local C:\\... ni file://).

## Packs de textures

Chaque pack est un dossier dans :

- public/cards/<NomDuPack>/

Exemple pour le pack par defaut :

- public/cards/Classic/

Le pack par defaut et la liste des packs autorises sont declares dans :

- texture-packs.js

Commande en jeu :

- /texture list
- /texture <NomDuPack>

## Convention de nommage (dans chaque pack)

- Dos de carte : BACK.png
- Faces : <RANG>_<COULEUR>.png

Avec :

- RANG : SEPT, HUIT, NEUF, DIX, VALET, DAME, ROI, AS
- COULEUR : COEUR, CARREAU, TREFLE, PIC

Exemples :

- public/cards/Classic/AS_PIC.png
- public/cards/Classic/DIX_CARREAU.png
- public/cards/Classic/VALET_COEUR.png
