# GameHUBZ - Instructions de Build et Installation

## 📋 Prérequis

### Logiciels Requis:
- **Node.js** (v16 ou plus récent)
- **Python** (v3.7 ou plus récent)  
- **PyInstaller**: `pip install pyinstaller`
- **Git** (optionnel, pour cloner le repo)

### Dépendances NPM:
```bash
npm install
```

## 🔨 Créer l'Installateur

### Option 1: Script Automatisé (Recommandé)
```bash
npm run build-all
```

### Option 2: Étapes Manuelles
```bash
# 1. Installer electron-builder si pas déjà fait
npm install --save-dev electron-builder

# 2. Construire le scanner Python
npm run build-scanner

# 3. Construire l'application et l'installateur
npm run build-app
```

### Option 3: Script Personnalisé
```bash
node build-installer.js
```

## 📁 Structure des Fichiers de Build

```
GameHUBZ/
├── installer-dist/          # 📦 Installateurs générés
│   └── GameHUBZ-Setup-1.0.0.exe
├── build/                   # 🔧 Fichiers temporaires de build
├── scanner/
│   └── scan_all.exe         # 🐍 Scanner Python compilé
└── node_modules/            # 📚 Dépendances
```

## ⚙️ Configuration de l'Installateur

### Fichiers de Configuration:
- **`package.json`** - Configuration principale electron-builder
- **`electron-builder.yml`** - Configuration avancée (optionnel)
- **`build-installer.js`** - Script d'automatisation

### Personnalisation NSIS:
- **Icône**: `assets/icon.ico`
- **Nom**: GameHUBZ
- **Raccourcis**: Bureau + Menu Démarrer
- **Désinstalleur**: Inclus automatiquement

## 🎯 Types de Build Disponibles

### 1. **Développement**
```bash
npm start              # Lance l'app en mode dev
```

### 2. **Production (Portable)**
```bash
npm run dist          # Crée un dossier portable
```

### 3. **Installateur Windows**
```bash
npm run build-all     # Crée l'installateur .exe
```

## 📊 Résultats du Build

### Installateur Généré:
- **Nom**: `GameHUBZ-Setup-1.0.0.exe`
- **Emplacement**: `installer-dist/`
- **Taille**: ~150-200 MB (incluant Electron + Scanner)
- **Type**: Installateur NSIS avec assistant

### Fonctionnalités de l'Installateur:
✅ Assistant d'installation personnalisé  
✅ Choix du répertoire d'installation  
✅ Raccourcis Bureau et Menu Démarrer  
✅ Désinstalleur automatique  
✅ Exécution après installation  
✅ Support de l'élévation UAC  

## 🐛 Dépannage

### Erreur PyInstaller:
```bash
pip install --upgrade pyinstaller
```

### Erreur electron-builder:
```bash
npm install --save-dev electron-builder@latest
```

### Problème de permissions:
- Exécuter PowerShell en tant qu'administrateur
- Ou utiliser `--no-asar` dans electron-builder

### Scanner non trouvé:
- Vérifier que `scanner/scan_all.exe` existe
- Re-compiler avec `npm run build-scanner`

## 🚀 Distribution

### Pour distribuer l'installateur:
1. Localiser `installer-dist/GameHUBZ-Setup-1.0.0.exe`
2. Tester sur une machine propre
3. Optionnel: Signer le code pour éviter les warnings Windows
4. Héberger sur GitHub Releases ou autre plateforme

### Signature de Code (Optionnel):
```javascript
// Dans package.json > build > win
"certificateFile": "path/to/certificate.p12",
"certificatePassword": "password",
"publisherName": "Your Company Name"
```

## 📝 Notes de Version

### v1.0.0:
- ✅ Scanner multi-plateforme (Steam, Epic, GOG, etc.)
- ✅ Interface graphique moderne
- ✅ Système de favoris
- ✅ Barre de progression temps réel
- ✅ Chargement progressif des jeux
- ✅ Installateur Windows NSIS

---

## 🆘 Besoin d'Aide?

Si vous rencontrez des problèmes:
1. Vérifiez les logs dans la console
2. Assurez-vous que tous les prérequis sont installés
3. Testez d'abord `npm start` pour vérifier que l'app fonctionne
4. Consultez la documentation d'electron-builder