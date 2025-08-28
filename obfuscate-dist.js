const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Configuration d'obfuscation optimisée
const obfuscationOptions = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.4,
    debugProtection: false,
    debugProtectionInterval: 0,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    numbersToExpressions: true,
    renameGlobals: false,
    rotateStringArray: true,
    selfDefending: true,
    shuffleStringArray: true,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 10,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersParametersMaxCount: 4,
    stringArrayWrappersType: 'function',
    stringArrayThreshold: 0.75,
    transformObjectKeys: true,
    unicodeEscapeSequence: false
};

function findDistFolder() {
    const distPath = path.join(__dirname, 'dist');
    if (!fs.existsSync(distPath)) {
        return null;
    }
    
    // Chercher le dossier GameHubZ-*
    const directories = fs.readdirSync(distPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name)
        .filter(name => name.startsWith('GameHubZ'));
    
    if (directories.length === 0) {
        return null;
    }
    
    const appPath = path.join(distPath, directories[0], 'resources', 'app');
    return fs.existsSync(appPath) ? appPath : null;
}

function obfuscateFile(inputPath, outputPath) {
    console.log(`Obfuscating ${path.relative(__dirname, inputPath)}...`);
    
    try {
        const sourceCode = fs.readFileSync(inputPath, 'utf8');
        const obfuscatedCode = JavaScriptObfuscator.obfuscate(sourceCode, obfuscationOptions).getObfuscatedCode();
        
        // Créer une sauvegarde du fichier original
        const backupPath = inputPath + '.original';
        if (!fs.existsSync(backupPath)) {
            fs.copyFileSync(inputPath, backupPath);
        }
        
        // Écrire le code obfusqué
        fs.writeFileSync(outputPath || inputPath, obfuscatedCode);
        console.log(`✓ ${path.relative(__dirname, inputPath)} obfuscated successfully`);
        
        return true;
    } catch (error) {
        console.error(`Error obfuscating ${inputPath}:`, error.message);
        return false;
    }
}

function main() {
    console.log('🔒 Starting post-build obfuscation...');
    
    // Trouver le dossier de distribution
    const appPath = findDistFolder();
    if (!appPath) {
        console.error('❌ Distribution folder not found. Make sure to run this after "npm run dist".');
        process.exit(1);
    }
    
    console.log(`📂 Found app directory: ${path.relative(__dirname, appPath)}`);
    
    // Fichiers à obfusquer
    const filesToObfuscate = [
        path.join(appPath, 'ui', 'main.js'),
        path.join(appPath, 'ui', 'renderer.js')
    ];
    
    let successCount = 0;
    let totalFiles = 0;
    
    for (const filePath of filesToObfuscate) {
        if (fs.existsSync(filePath)) {
            totalFiles++;
            if (obfuscateFile(filePath)) {
                successCount++;
            }
        } else {
            console.warn(`⚠️  File not found: ${path.relative(__dirname, filePath)}`);
        }
    }
    
    console.log('');
    if (successCount === totalFiles && totalFiles > 0) {
        console.log(`✅ Successfully obfuscated ${successCount}/${totalFiles} files`);
        console.log('🔒 Your code is now protected in the distribution build!');
    } else {
        console.error(`❌ Obfuscation completed with issues: ${successCount}/${totalFiles} files processed`);
        process.exit(1);
    }
}

// Exécuter le script
if (require.main === module) {
    main();
}