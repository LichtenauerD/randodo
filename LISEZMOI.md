# Randodo

Choisir une randonnée simplement, puis la suivre sans réseau. Version 1.3.4.

## Mise en ligne (dix minutes, comme tes carnets)

1. Sur GitHub, crée un dépôt public nommé `randodo`.
2. Dans le dépôt : **Add file > Upload files**, puis glisse **tout le contenu** du dossier `randodo` (les dossiers `js`, `css`, `data`, `vendor`, `icons`, `apps-script` et les fichiers à la racine). Valide avec **Commit changes**.
3. **Settings > Pages** : source **Deploy from a branch**, branche `main`, dossier `/ (root)`, puis **Save**.
4. Une à deux minutes plus tard, ouvre `https://lichtenauerd.github.io/randodo/` dans Safari, puis **Partager > Sur l'écran d'accueil**. L'icône est le dodo randonneur.

## Premier lancement : le diagnostic

L'appli a été testée sur des services simulés, pas sur les vrais serveurs. Avant toute chose, ouvre **Réglages > Lancer le diagnostic**. Chaque service passe au vert ou au rouge. **Copier le rapport** te donne un texte à me renvoyer si une ligne est rouge.

## Relier le groupe (cinq minutes)

L'onglet « Communauté » a besoin d'un endroit commun. C'est une feuille Google qui t'appartient.

1. Crée une feuille Google vide (par exemple « Randodo, randos du groupe »).
2. Menu **Extensions > Apps Script**. Efface le contenu affiché, colle celui de `apps-script/Code.gs`, enregistre.
3. **Déployer > Nouveau déploiement**, type **Application Web**. « Exécuter en tant que » : **Moi**. « Qui a accès » : **Tout le monde**. Clique **Déployer** et accepte l'autorisation demandée.
4. Copie l'adresse qui finit par `/exec`. Dans Randodo : **Réglages > Adresse du groupe**, colle-la, puis **Tester l'adresse**.
5. Pour tes proches : colle la même adresse dans `js/config.js`, à la ligne `communityUrl: ''`, et redépose ce fichier sur GitHub. L'appli leur demandera simplement leur prénom au premier lancement.

À savoir : toute personne qui connaît cette adresse peut lire les randos partagées et en ajouter. Seul l'appareil qui a partagé une rando peut la modifier ou la retirer. Tu peux aussi corriger ou supprimer une ligne directement dans la feuille.

## Les cinq onglets

- **Accueil.** Une phrase à compléter lance la recherche : point de départ, temps de route, ce que tu veux voir, niveau. En dessous, l'idée de la semaine, trois autres pistes, puis les idées lues ailleurs quand la veille en a trouvé.
- **Carte.** Les sites de la sélection apparaissent d'emblée, cerclés de jaune. En zoomant, tous les lieux d'OpenStreetMap s'ajoutent. Un appui sur une bulle ouvre la fiche : une proposition par niveau, les liens vers les plateformes, le balisage présent sur place. Un appui long sur la carte permet de partir de n'importe quel point.
- **Traces.** Les randonnées gardées sur le téléphone, et l'import d'un GPX venu de Komoot, AllTrails ou d'ailleurs.
- **Historique.** « Mes randos », « Communauté » et « Envies ».
- **Réglages.** Pseudo, adresse du groupe, sauvegarde, diagnostic, démonstration du guidage.

## Les fonds de carte

Le bouton en bas à droite de la carte ouvre le choix du fond.

- **Rando** (par défaut) : carte topographique OpenTopoMap, avec relief, courbes de niveau et sentiers. Couvre la France, l'Allemagne et la Suisse.
- **IGN** : le Plan IGN, en accès libre. France seulement.
- **Swisstopo** : la carte nationale suisse. Suisse seulement.
- **Plan** : la carte générale OpenStreetMap.
- **Itinéraires balisés** : une surcouche (Waymarked Trails) qui dessine les circuits balisés sur n'importe quel fond.
- **IGN 1:25 000** : la vraie carte de randonnée de l'IGN est en accès restreint. Le fond n'apparaît que si une clé d'accès Géoplateforme est saisie dans Réglages. Vérifie les conditions d'usage de la clé avant de la partager avec tes proches.

Si un fond ne répond pas, l'appli revient d'elle-même au plan général et te prévient. Le tracé est violet avec un liseré blanc et des flèches de sens de marche, pour rester lisible sur une carte chargée.

## Le prénom et les membres

Au premier lancement sur un téléphone, l'appli demande le prénom. Il signe les randos partagées. Si l'adresse du groupe est renseignée, le téléphone est inscrit dans l'onglet « Membres » de la feuille Google (prénom, date d'arrivée), et l'onglet Communauté affiche qui fait partie du groupe. Le prénom se change dans Réglages.

## La recherche guidée

- **Temps de route.** Calculé par le service public OSRM depuis ton point de départ. S'il ne répond pas, l'appli l'estime à partir de la distance et l'indique par « environ ».
- **Lieux proposés.** Jusqu'à 1 h 30 de route : les sites de la sélection, plus les lieux notables d'OpenStreetMap des types cochés. Au-delà : les sites de la sélection seulement.
- **Niveau.** Les niveaux disponibles sont calculés pour les quatre premiers résultats. Pour les autres, ils s'affichent en ouvrant le lieu. Le niveau coché devient ton « envie du jour » sur la carte.

## Les suggestions

- **L'idée de la semaine et les trois autres.** Quatre sites de la sélection, de types différents, non encore faits, à portée de ton point de départ, tirés au sort chaque lundi. De novembre à avril, les sites d'altitude sont écartés.
- **Lu ailleurs.** Une appli hébergée sur GitHub ne peut pas lire elle-même les articles et les blogs. Cette rubrique, masquée tant qu'elle est vide, affiche donc l'onglet « Suggestions » de la feuille du groupe, une ligne par idée : semaine, titre, lieu, latitude, longitude, type, niveau, km, pourquoi, source, lien. Il peut être rempli chaque semaine par une tâche planifiée de Claude, ou à la main.

## D'où viennent les randonnées

Komoot et AllTrails n'ouvrent pas leurs itinéraires aux applis extérieures. Randodo s'appuie donc sur les données ouvertes :

- **Tracés calculés.** Pour chaque lieu, l'appli charge les sentiers dans un rayon de 5 km, repère les parkings, puis construit des boucles en privilégiant les sentiers balisés et en évitant les routes. Elle en garde une par niveau.
- **Circuits balisés.** Quand OpenStreetMap contient un circuit complet passant par le lieu, il est proposé tel quel, avec un lien vers sa trace sur Waymarked Trails.
- **Liens.** Les boutons Komoot, AllTrails, Visorando, Bergfex, Outdooractive et SuisseMobile ouvrent ces sites sur le lieu, pour les avis, les photos et les variantes.

Niveaux : facile jusqu'à 8 km et 300 m de montée, moyenne jusqu'à 15 km et 700 m, difficile au-delà. Durée : formule des panneaux de randonnée (4 km/h à plat, 300 m/h en montée, 500 m/h en descente).

## Limites à connaître

- **Tracés automatiques.** Une boucle calculée n'a été parcourue par personne. Elle suit des sentiers cartographiés, mais leur état réel n'est pas garanti. Regarde la trace avant de partir et croise avec une plateforme pour une sortie engagée.
- **Dénivelé approché.** Le modèle de terrain a une maille de 90 m : la montée est plutôt sous-estimée sur les reliefs découpés.
- **Guidage sur iPhone.** Une appli web ne suit le GPS que si elle est ouverte, écran allumé. L'appli empêche la mise en veille quand le téléphone le permet. Pour une longue sortie, le plus sûr reste d'envoyer aussi la trace dans Organic Maps (bouton « Trace GPX »).
- **Carte hors ligne.** Les tuiles ne sont pas téléchargées d'avance. Hors réseau, l'appli affiche la trace, les sentiers voisins dessinés par elle-même, et les portions de carte déjà consultées.
- **Liens directs Komoot et AllTrails.** Leur format n'a pas pu être confirmé. S'ils n'ouvrent pas la bonne page, décoche « Liens directs » dans Réglages : les boutons lanceront une recherche web limitée au site.
- **Coordonnées de la sélection.** Elles sont approchées et s'affinent toutes seules à la première consultation en ligne.

## Modifier sans toucher au code

Tout ce qui est réglable se trouve dans `js/config.js` : seuils des niveaux, rayon de recherche, distance d'alerte, serveurs de données, liens des plateformes, adresse du groupe. La sélection de sites est dans `data/sites.js`, une ligne par site.

## Sources

Lieux, sentiers et balisage : © contributeurs OpenStreetMap (ODbL). Photos : Wikimedia Commons et Wikipédia. Altitudes : Open-Meteo. Recherche : Photon. Fonds de carte : OpenTopoMap, IGN, swisstopo, OpenStreetMap, Waymarked Trails. Temps de route : OSRM. Carte : Leaflet. Police : Barlow Semi Condensed (SIL OFL).

## Photos des lieux (version 1.3.0)

Les photos locales vont dans le dossier `photos/`, avec une ligne par lieu dans `data/photos.js`. Elles remplacent les photos trouvées automatiquement, et leur crédit s'affiche sur la fiche du lieu. Le détail des règles est dans `photos/LISEZMOI.txt`.
