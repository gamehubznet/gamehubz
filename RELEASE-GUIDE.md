# 🚀 Guide de Publication GameHUBZ

## Processus complet pour publier une nouvelle version

### 1. 📝 Préparation de la Release

#### Modifier la version dans package.json
```bash
# Ouvrir package.json et changer la version
# Exemple: "version": "0.3.2"
```

#### Faire les modifications de code nécessaires
- Corriger des bugs
- Ajouter des fonctionnalités
- Améliorer l'interface

### 2. 🔄 Git Operations

#### Ajouter tous les changements
```bash
git add .
```

#### Créer un commit descriptif
```bash
git commit -m "Version 0.3.2 - Description des changements

- Fonctionnalité 1
- Correction de bug X
- Amélioration Y

🤖 Generated with Claude Code

Co-Authored-By: Claude <noreply@anthropic.com>"
```

#### Pousser vers GitHub
```bash
git push origin clean-main:main
```

### 3. 🏗️ Build & Publication

#### Option 1: Script PowerShell (Recommandé)
```bash
powershell -ExecutionPolicy Bypass -File test-publish.ps1
```

#### Option 2: Commandes manuelles
```bash
# Définir le token GitHub (à faire une seule fois par session)
set GH_TOKEN=votre_token_github_ici

# Construire et publier
node publish-release.js
```

#### Option 3: Commande npm
```bash
set GH_TOKEN=votre_token_github_ici
npm run publish
```

### 4. ✅ Vérification

#### Sur GitHub
1. Aller sur https://github.com/gamehubznet/gamehubz/releases
2. Vérifier que la nouvelle release apparaît
3. Télécharger le fichier .exe pour tester

#### Dans l'application
1. Lancer l'ancienne version
2. Cliquer sur "🔄 Check for Updates" dans la sidebar
3. Vérifier que la mise à jour est détectée

## 📋 Checklist de Release

- [ ] Version modifiée dans package.json
- [ ] Changements committé et pushés
- [ ] Token GitHub configuré (`GH_TOKEN`)
- [ ] Script de publication exécuté sans erreur
- [ ] Release visible sur GitHub
- [ ] Fichier .exe téléchargeable
- [ ] Mise à jour détectée dans l'app

## 🔧 Fichiers Importants

- **package.json** : Version de l'application
- **test-publish.ps1** : Script de publication PowerShell
- **publish-release.js** : Script Node.js de publication
- **latest.yml** : Configuration pour l'auto-updater (généré automatiquement)

## 🆘 Dépannage

### Erreur "Repository is empty"
- Vérifier que le code source est bien pushé sur GitHub
- S'assurer que la branche `main` existe

### Erreur "Token invalid"
- Vérifier que `GH_TOKEN` est bien défini
- Régénérer le token sur GitHub si nécessaire

### Erreur de build
- Vérifier que Python et PyInstaller sont installés
- Vérifier que toutes les dépendances npm sont installées

### Release en "Draft"
- Utiliser l'API pour publier : 
```bash
curl -X PATCH -H "Authorization: token $GH_TOKEN" -H "Content-Type: application/json" -d '{"draft": false}' https://api.github.com/repos/gamehubznet/gamehubz/releases/[RELEASE_ID]
```

## 📱 URLs Utiles

- **Repository** : https://github.com/gamehubznet/gamehubz
- **Releases** : https://github.com/gamehubznet/gamehubz/releases
- **Actions** : https://github.com/gamehubznet/gamehubz/actions

---
*Dernière mise à jour : 28 août 2025 - Version 0.3.1*