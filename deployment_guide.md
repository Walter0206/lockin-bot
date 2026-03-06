# Guide de Déploiement : Lockin-Bot sur Railway

Suis ces étapes pour mettre ton bot en ligne 24h/24 avec son Dashboard.

## 1. Préparation (GitHub)
Railway se connecte directement à GitHub pour déployer ton code.
1. Crée un nouveau dépôt (repository) **privé** sur GitHub.
2. Pousse ton code local vers ce dépôt :
   ```bash
   git init
   git add .
   git commit -m "Initial commit with Dashboard"
   git branch -M main
   git remote add origin https://github.com/TON_NOM_UTILISATEUR/lockin-bot.git
   git push -u origin main
   ```

## 2. Déploiement sur Railway
1. Va sur [Railway.app](https://railway.app/) et connecte-toi avec ton compte GitHub.
2. Clique sur **"New Project"** > **"Deploy from GitHub repo"**.
3. Sélectionne ton dépôt `lockin-bot`.

## 3. Ajouter la Base de Données
1. Une fois le projet créé, clique sur **"Add Service"** (ou le bouton `+`).
2. Choisis **"Database"** > **"Add PostgreSQL"**.
3. Railway va automatiquement lier la base de données à ton bot via la variable `DATABASE_URL`.

## 4. Configuration des Variables d'Environnement
Dans l'onglet **Variables** de ton service "lockin-bot" sur Railway, ajoute :
- `TOKEN` : Ton token de bot Discord (celui qui est dans ton `.env` actuel).

## 5. Vérification
1. Attends que le déploiement se termine (icône verte ✅).
2. Va dans l'onglet **Settings** du service "lockin-bot".
3. Sous **Networking**, clique sur **"Generate Domain"**.
4. Ton Dashboard sera accessible sur l'URL générée (ex: `lockin-bot-production.up.railway.app`).

---
> [!IMPORTANT]
> Ne partage jamais ton fichier `.env` sur GitHub. Le fichier `.gitignore` actuel devrait déjà exclure le `.env`, mais vérifie bien avant de pousser.
