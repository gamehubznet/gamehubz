#!/usr/bin/env node
/**
 * Script d'automatisation pour créer l'installateur GameHUBZ
 * Étapes:
 * 1. Compile le scanner Python en .exe
 * 2. Build l'application Electron
 * 3. Crée l'installateur NSIS
 * 4. Nettoie les fichiers temporaires
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');

// Couleurs pour les logs
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  console.log(colors[color] + message + colors.reset);
}

function logStep(step, message) {
  log(`\n[${step}] ${message}`, 'cyan');
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function executeCommand(command, description) {
  logStep('EXEC', `${description}...`);
  try {
    execSync(command, { stdio: 'inherit' });
    logSuccess(`${description} completed`);
    return true;
  } catch (error) {
    logError(`${description} failed: ${error.message}`);
    return false;
  }
}

async function checkPrerequisites() {
  logStep('CHECK', 'Checking prerequisites...');
  
  // Vérifier Node.js
  try {
    const nodeVersion = execSync('node --version', { encoding: 'utf8' }).trim();
    log(`Node.js: ${nodeVersion}`, 'green');
  } catch (error) {
    logError('Node.js not found');
    process.exit(1);
  }
  
  // Vérifier Python
  try {
    const pythonVersion = execSync('python --version', { encoding: 'utf8' }).trim();
    log(`Python: ${pythonVersion}`, 'green');
  } catch (error) {
    logError('Python not found');
    process.exit(1);
  }
  
  // Vérifier PyInstaller
  try {
    execSync('python -m PyInstaller --version', { encoding: 'utf8' });
    log('PyInstaller: Available', 'green');
  } catch (error) {
    logError('PyInstaller not found. Install with: pip install pyinstaller');
    process.exit(1);
  }
  
  // Vérifier les dépendances npm
  if (!fs.existsSync('node_modules')) {
    logWarning('node_modules not found. Installing dependencies...');
    executeCommand('npm install', 'Installing npm dependencies');
  }
  
  logSuccess('All prerequisites checked');
}

function cleanOldBuilds() {
  logStep('CLEAN', 'Cleaning old builds...');
  
  const foldersToClean = ['dist', 'build', 'installer-dist'];
  
  for (const folder of foldersToClean) {
    if (fs.existsSync(folder)) {
      try {
        rimraf.sync(folder);
        log(`Cleaned ${folder}/`, 'yellow');
      } catch (error) {
        logWarning(`Could not clean ${folder}: ${error.message}`);
      }
    }
  }
  
  // Nettoyer l'ancien .exe du scanner s'il existe
  const oldExe = path.join('scanner', 'scan_all.exe');
  if (fs.existsSync(oldExe)) {
    try {
      fs.unlinkSync(oldExe);
      log('Cleaned old scanner executable', 'yellow');
    } catch (error) {
      logWarning(`Could not clean old exe: ${error.message}`);
    }
  }
  
  logSuccess('Cleanup completed');
}

function buildScanner() {
  logStep('SCANNER', 'Building Python scanner...');
  
  const command = 'python -m PyInstaller --onefile scanner/scan_all.py --noconfirm --distpath . && move /Y scan_all.exe scanner\\\\';
  
  if (!executeCommand(command, 'Building scanner executable')) {
    logError('Scanner build failed');
    process.exit(1);
  }
  
  // Vérifier que l'exe a été créé
  const exePath = path.join('scanner', 'scan_all.exe');
  if (!fs.existsSync(exePath)) {
    logError('Scanner executable not found after build');
    process.exit(1);
  }
  
  const stats = fs.statSync(exePath);
  const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  logSuccess(`Scanner built successfully (${fileSizeMB} MB)`);
}

function buildElectronApp() {
  logStep('ELECTRON', 'Building Electron application...');
  
  const command = 'npx electron-builder --win --publish never';
  
  if (!executeCommand(command, 'Building Electron app and installer')) {
    logError('Electron build failed');
    process.exit(1);
  }
  
  logSuccess('Electron app and installer built successfully');
}

function verifyInstaller() {
  logStep('VERIFY', 'Verifying installer...');
  
  const installerDir = 'installer-dist';
  if (!fs.existsSync(installerDir)) {
    logError('Installer directory not found');
    return false;
  }
  
  const files = fs.readdirSync(installerDir);
  const installerFiles = files.filter(file => file.endsWith('.exe'));
  
  if (installerFiles.length === 0) {
    logError('No installer executable found');
    return false;
  }
  
  for (const installer of installerFiles) {
    const installerPath = path.join(installerDir, installer);
    const stats = fs.statSync(installerPath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    logSuccess(`Installer created: ${installer} (${fileSizeMB} MB)`);
  }
  
  return true;
}

function showSummary() {
  logStep('SUMMARY', 'Build Summary');
  
  log('📦 GameHUBZ Installer Build Completed!', 'magenta');
  log('', 'reset');
  
  if (fs.existsSync('installer-dist')) {
    const files = fs.readdirSync('installer-dist');
    log('Generated files:', 'cyan');
    files.forEach(file => {
      const filePath = path.join('installer-dist', file);
      const stats = fs.statSync(filePath);
      const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      log(`  • ${file} (${fileSizeMB} MB)`, 'green');
    });
  }
  
  log('', 'reset');
  log('🚀 You can now distribute the installer!', 'green');
  log('📍 Location: installer-dist/', 'blue');
}

async function main() {
  const startTime = Date.now();
  
  log('🎮 GameHUBZ Installer Build Script', 'magenta');
  log('=====================================', 'magenta');
  
  try {
    await checkPrerequisites();
    cleanOldBuilds();
    buildScanner();
    buildElectronApp();
    
    if (verifyInstaller()) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      showSummary();
      log(`\n⏱️  Total build time: ${duration}s`, 'cyan');
    } else {
      logError('Installer verification failed');
      process.exit(1);
    }
    
  } catch (error) {
    logError(`Build failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// Gestion des signaux pour cleanup
process.on('SIGINT', () => {
  log('\n🛑 Build interrupted by user', 'yellow');
  process.exit(1);
});

process.on('SIGTERM', () => {
  log('\n🛑 Build terminated', 'yellow');
  process.exit(1);
});

// Lancer le script
main().catch(error => {
  logError(`Unexpected error: ${error.message}`);
  console.error(error);
  process.exit(1);
});