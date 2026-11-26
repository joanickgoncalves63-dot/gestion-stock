# Gestion de stock

Application Android (tablette et smartphone) pour gérer le stock d'une petite PME : 3 personnes, un seul site.

- Catalogue d'articles : référence, code-barres, catégorie, emplacement, unité, prix, seuil d'alerte.
- Entrées, sorties et inventaires en deux touches, avec un journal de tous les mouvements (qui, quand, combien).
- Alertes « Stock bas » et « Rupture », tableau de bord avec la valeur du stock.
- Recherche et douchette code-barres USB ou Bluetooth : on scanne, la fiche s'ouvre.
- Import d'un fichier Excel (.xlsx) ou CSV de références fournisseur, avec reconnaissance automatique des colonnes.
- Export CSV du stock, du journal et d'une liste de commande, envoyé par le menu « Partager » d'Android.
- Stock partagé entre les appareils et utilisable sans réseau : les saisies partent dès que la connexion revient.

Tant que Firebase n'est pas configuré, l'application tourne en **mode démonstration** : les données restent sur l'appareil.

## Mise en route

### 1. Créer la base de données Firebase (gratuite)

1. Allez sur <https://console.firebase.google.com>, cliquez sur « Créer un projet », nommez-le `gestion-stock`. Google Analytics n'est pas utile.
2. Menu **Build > Authentication** : « Commencer », puis activez **Adresse e-mail/Mot de passe**.
3. Onglet **Users** : « Ajouter un utilisateur » pour chacune des 3 personnes (e-mail + mot de passe provisoire).
4. Menu **Build > Firestore Database** : « Créer une base de données », emplacement `europe-west` (par exemple `eur3`), mode production.
5. Onglet **Règles** : collez le contenu de [`firestore.rules`](firestore.rules) en remplaçant les 3 adresses d'exemple par les vôtres, puis **Publier**.
6. **Paramètres du projet** (roue dentée) > **Vos applications** > icône Web `</>` : enregistrez une application. Copiez les valeurs affichées (`apiKey`, `projectId`…) dans [`src/firebase-config.js`](src/firebase-config.js).

Ces valeurs ne sont pas secrètes : c'est la liste d'adresses des règles Firestore qui protège les données.

### 2. Récupérer l'application de test

À chaque modification, GitHub compile l'application (onglet **Actions** du dépôt). Ouvrez la dernière exécution réussie, téléchargez `gestion-stock-test-apk`, décompressez-le et installez `app-debug.apk` sur le téléphone. Android demandera d'autoriser l'installation depuis cette source.

### 3. Publier sur le Play Store

1. Créez un compte développeur sur <https://play.google.com/console> (25 $ une seule fois). Un compte personnel récent doit faire tester l'application par 12 personnes pendant 14 jours avant la mise en production ; un compte **organisation** (avec numéro D-U-N-S de l'entreprise) n'a pas cette obligation. Pour un usage interne, le « test fermé » suffit et ne rend pas l'application publique.
2. Créez une clé de signature (une seule fois, à garder précieusement) :
   ```sh
   keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 upload.jks   # sous macOS : base64 -i upload.jks
   ```
3. Dans GitHub : **Settings > Secrets and variables > Actions**, ajoutez `ANDROID_KEYSTORE_BASE64` (le résultat de la commande base64), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`upload`) et `ANDROID_KEY_PASSWORD`.
4. Relancez la compilation : un fichier `gestion-stock-play-store-aab` apparaît. Envoyez `app-release.aab` dans la Play Console.

L'identifiant de l'application est `fr.pme.gestionstock` (fichier `capacitor.config.json` et `android/app/build.gradle`). Il ne pourra plus changer après le premier envoi sur le Play Store.

## Développement

```sh
npm install
npm run dev            # application dans le navigateur (mode démonstration)
npm test               # tests de la logique (statuts, CSV, import)
npm run android:sync   # construit et copie dans le projet Android
npm run android:open   # ouvre Android Studio
```

Organisation du code :

- `src/main.js` : écrans et interactions.
- `src/store.js` : données (Firebase ou démonstration locale).
- `src/logic.js` : règles métier sans interface (statuts, CSV, reconnaissance des colonnes d'import), testées dans `test/`.
- `src/io.js` : lecture des fichiers importés, partage des exports.
- `android/` : projet Android généré par Capacitor.
