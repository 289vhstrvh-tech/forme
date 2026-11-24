# Forme

Appli web (PWA) de suivi nutrition et musculation, en français, pensée pour l'iPhone.
Toutes les données restent sur l'appareil (localStorage) ; rien n'est envoyé à un serveur.

- Aliments : table Ciqual 2020 de l'ANSES (Licence Ouverte Etalab), viandes et boissons alcoolisées exclues ; produits de marque via Open Food Facts (ODbL).
- Liaison avec l'app Santé via l'app Raccourcis (mode d'emploi dans l'onglet Profil).

## Développement

```
node tools/serve.mjs          # http://localhost:5173
node tools/build-foods.mjs <dossier-xml-ciqual> docs/foods.json
```
