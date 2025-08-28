const { autoUpdater } = require('electron-updater');
const { dialog, shell } = require('electron');
const log = require('electron-log');

// Configuration des logs
log.transports.file.level = 'info';
autoUpdater.logger = log;

class GameHUBZUpdater {
    constructor() {
        this.updateAvailable = false;
        this.isChecking = false;
        this.setupAutoUpdater();
    }

    setupAutoUpdater() {
        // Configuration
        autoUpdater.autoDownload = false; // Ne pas télécharger automatiquement
        autoUpdater.allowPrerelease = false; // Seulement les versions stables
        autoUpdater.allowDowngrade = true; // Permettre les downgrades
        
        // Ignorer les erreurs de signature pour les apps non signées
        process.env.ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES = 'true';

        // Événements
        autoUpdater.on('checking-for-update', () => {
            log.info('[UPDATER] Vérification des mises à jour...');
            this.isChecking = true;
        });

        autoUpdater.on('update-available', (info) => {
            log.info('[UPDATER] Mise à jour disponible:', info.version);
            this.updateAvailable = true;
            this.isChecking = false;
            this.showUpdateAvailableDialog(info);
        });

        autoUpdater.on('update-not-available', () => {
            log.info('[UPDATER] Aucune mise à jour disponible');
            this.updateAvailable = false;
            this.isChecking = false;
        });

        autoUpdater.on('error', (err) => {
            log.error('[UPDATER] Erreur:', err);
            this.isChecking = false;
            
            // Gérer spécifiquement les erreurs de signature
            if (err.message && err.message.includes('not signed')) {
                this.showSignatureWarningDialog();
            } else {
                this.showErrorDialog(err);
            }
        });

        autoUpdater.on('download-progress', (progressObj) => {
            const { percent, bytesPerSecond, total, transferred } = progressObj;
            log.info(`[UPDATER] Téléchargement: ${Math.round(percent)}% - ${Math.round(bytesPerSecond/1024)}KB/s`);
            
            // Envoyer le progrès à l'interface si nécessaire
            this.sendProgressToRenderer(progressObj);
        });

        autoUpdater.on('update-downloaded', () => {
            log.info('[UPDATER] Mise à jour téléchargée');
            this.showUpdateReadyDialog();
        });
    }

    async checkForUpdates(showNoUpdateDialog = false) {
        if (this.isChecking) {
            return;
        }

        try {
            const result = await autoUpdater.checkForUpdates();
            
            if (showNoUpdateDialog && !this.updateAvailable) {
                dialog.showMessageBox({
                    type: 'info',
                    title: 'GameHUBZ - Mises à jour',
                    message: 'Vous utilisez déjà la dernière version de GameHUBZ !',
                    detail: `Version actuelle : ${require('../package.json').version}`,
                    buttons: ['OK']
                });
            }
            
            return result;
        } catch (error) {
            log.error('[UPDATER] Erreur lors de la vérification:', error);
            if (showNoUpdateDialog) {
                this.showErrorDialog(error);
            }
        }
    }

    showUpdateAvailableDialog(info) {
        const currentVersion = require('../package.json').version;
        
        dialog.showMessageBox({
            type: 'info',
            title: 'GameHUBZ - Mise à jour disponible',
            message: `Une nouvelle version de GameHUBZ est disponible !`,
            detail: `Version actuelle : ${currentVersion}\nNouvelle version : ${info.version}\n\nVoulez-vous télécharger et installer cette mise à jour ?`,
            buttons: ['Télécharger et installer', 'Plus tard', 'Voir les notes de version'],
            defaultId: 0,
            cancelId: 1
        }).then((result) => {
            if (result.response === 0) {
                // Télécharger et installer
                this.downloadAndInstall();
            } else if (result.response === 2) {
                // Voir les notes de version
                const releaseUrl = `https://github.com/gamehubz/gamehubz/releases/tag/v${info.version}`;
                shell.openExternal(releaseUrl);
            }
        });
    }

    showUpdateReadyDialog() {
        dialog.showMessageBox({
            type: 'info',
            title: 'GameHUBZ - Mise à jour prête',
            message: 'La mise à jour a été téléchargée avec succès !',
            detail: 'GameHUBZ va se fermer et se relancer avec la nouvelle version.',
            buttons: ['Redémarrer maintenant', 'Plus tard'],
            defaultId: 0,
            cancelId: 1
        }).then((result) => {
            if (result.response === 0) {
                autoUpdater.quitAndInstall();
            }
        });
    }

    showErrorDialog(error) {
        dialog.showErrorBox(
            'GameHUBZ - Erreur de mise à jour',
            `Une erreur s'est produite lors de la vérification des mises à jour :\n\n${error.message}`
        );
    }

    showSignatureWarningDialog() {
        const response = dialog.showMessageBoxSync({
            type: 'warning',
            title: 'Application non signée',
            message: 'La mise à jour n\'est pas signée numériquement',
            detail: 'Windows bloque l\'installation car l\'application n\'a pas de signature numérique valide. Vous pouvez :\n\n1. Télécharger manuellement depuis GitHub\n2. Continuer avec Windows Defender (non recommandé)\n3. Attendre une version signée',
            buttons: ['Télécharger manuellement', 'Ignorer', 'Annuler'],
            defaultId: 0,
            cancelId: 2
        });

        if (response === 0) {
            // Ouvrir GitHub releases
            shell.openExternal('https://github.com/gamehubznet/gamehubz/releases');
        }
    }

    downloadAndInstall() {
        dialog.showMessageBox({
            type: 'info',
            title: 'GameHUBZ - Téléchargement',
            message: 'Téléchargement de la mise à jour en cours...',
            detail: 'Veuillez patienter, cela peut prendre quelques minutes selon votre connexion.',
            buttons: ['OK']
        });

        autoUpdater.downloadUpdate();
    }

    sendProgressToRenderer(progressObj) {
        // Cette fonction peut être utilisée pour envoyer le progrès à l'interface utilisateur
        // via IPC si nécessaire
    }

    // Vérification automatique au démarrage (optionnel)
    enableAutoCheck(intervalHours = 24) {
        // Vérifier une fois au démarrage (après 10 secondes)
        setTimeout(() => {
            this.checkForUpdates(false);
        }, 10000);

        // Puis vérifier périodiquement
        setInterval(() => {
            this.checkForUpdates(false);
        }, intervalHours * 60 * 60 * 1000);
    }
}

module.exports = GameHUBZUpdater;