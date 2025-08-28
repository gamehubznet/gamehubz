// renderer.js — Version allégée (sans traductions ni paramètres)
// - Loader/scan robuste (watcher + timeout)
// - Favoris, recherche, tri, filtres, rendu
// - Lancement des jeux (Steam/Epic/exec)

const fs = require('fs');
const path = require('path');
const https = require('https');
const { shell, app } = require('electron');
const { execFile, spawn } = require('child_process');
const { pathToFileURL } = require('url');
// Manual isDev detection to avoid ES Module issues
const isDev = process.defaultApp || /[\\/]electron-prebuilt[\\/]/.test(process.execPath) || /[\\/]electron[\\/]/.test(process.execPath);

// ————— Constantes & Chemins ——————————
const API_KEY = '7a16155f1842fd8ee0b46f681fd5a207';
const BASE_URL = 'https://www.steamgriddb.com/api/v2';

// Variables de contrôle de rendu pour éviter les doublons
let isRendering = false;
let currentRenderAbortController = null;
let sortAndRenderTimer = null;
let pendingCardTimers = [];

// Chemins adaptatifs selon l'environnement
function getAppPath() {
  if (isDev) {
    return path.join(__dirname, '..');
  } else {
    // En production, utiliser le chemin de l'app packagée
    return path.dirname(process.execPath);
  }
}

function getResourcesPath() {
  if (isDev) {
    return path.join(__dirname, '..');
  } else {
    // Dans l'app packagée avec ASAR désactivé, les ressources sont dans resources/app/
    const execDir = path.dirname(process.execPath);
    const resourcesDir = path.join(execDir, 'resources', 'app');
    if (fs.existsSync(resourcesDir)) {
      return resourcesDir;
    }
    
    // Si extraResources est utilisé, les ressources sont dans resources/
    const extraResourcesDir = path.join(execDir, 'resources');
    if (fs.existsSync(extraResourcesDir)) {
      return extraResourcesDir;
    }
    
    // Fallback si la structure est différente
    return execDir;
  }
}

const APP_PATH = getAppPath();
const RESOURCES_PATH = getResourcesPath();
const GAMES_JSON = path.join(RESOURCES_PATH, 'games.json');
const CACHE_DIR = path.join(__dirname, 'cache');

// Créer le dossier cache s'il n'existe pas et gérer sa taille
if (!fs.existsSync(CACHE_DIR)) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    console.log('[CACHE] Created cache directory:', CACHE_DIR);
  } catch (e) {
    console.warn('[CACHE] Could not create cache directory:', e);
  }
} else {
  // Vérifier la taille du cache au démarrage
  cleanupCache();
}

// Fonction de nettoyage du cache
function cleanupCache() {
  try {
    const files = fs.readdirSync(CACHE_DIR);
    const MAX_CACHE_SIZE_MB = 500; // Limite à 500MB
    const MAX_FILES = 1000; // Limite à 1000 fichiers
    
    if (files.length > MAX_FILES) {
      console.log('[CACHE] Too many files (', files.length, '), cleaning up...');
      // Trier par date de modification et supprimer les plus anciens
      const fileStats = files.map(file => {
        const filePath = path.join(CACHE_DIR, file);
        const stats = fs.statSync(filePath);
        return { file, path: filePath, mtime: stats.mtime };
      }).sort((a, b) => a.mtime - b.mtime);
      
      // Supprimer les 200 plus anciens fichiers
      const toDelete = fileStats.slice(0, 200);
      toDelete.forEach(({ path: filePath }) => {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          console.warn('[CACHE] Could not delete', filePath, ':', e);
        }
      });
      console.log('[CACHE] Deleted', toDelete.length, 'old cache files');
    }
    
    // Vérifier la taille totale
    let totalSize = 0;
    files.forEach(file => {
      try {
        const filePath = path.join(CACHE_DIR, file);
        const stats = fs.statSync(filePath);
        totalSize += stats.size;
      } catch (e) {}
    });
    
    const sizeMB = totalSize / (1024 * 1024);
    console.log('[CACHE] Current cache size:', Math.round(sizeMB), 'MB');
    
    if (sizeMB > MAX_CACHE_SIZE_MB) {
      console.log('[CACHE] Cache too large, cleaning up...');
      // Supprimer les fichiers les plus anciens jusqu'à atteindre la limite
      const fileStats = files.map(file => {
        const filePath = path.join(CACHE_DIR, file);
        const stats = fs.statSync(filePath);
        return { file, path: filePath, mtime: stats.mtime, size: stats.size };
      }).sort((a, b) => a.mtime - b.mtime);
      
      let currentSize = totalSize;
      let deletedCount = 0;
      for (const { path: filePath, size } of fileStats) {
        if (currentSize / (1024 * 1024) <= MAX_CACHE_SIZE_MB * 0.8) break; // Garder 80% de la limite
        try {
          fs.unlinkSync(filePath);
          currentSize -= size;
          deletedCount++;
        } catch (e) {
          console.warn('[CACHE] Could not delete', filePath, ':', e);
        }
      }
      console.log('[CACHE] Deleted', deletedCount, 'files to reduce cache size');
    }
  } catch (e) {
    console.warn('[CACHE] Error during cleanup:', e);
  }
}

// Logs de debug pour les chemins
console.log('[PATHS] isDev:', isDev);
console.log('[PATHS] __dirname:', __dirname);
console.log('[PATHS] process.execPath:', process.execPath);
console.log('[PATHS] APP_PATH:', APP_PATH);
console.log('[PATHS] RESOURCES_PATH:', RESOURCES_PATH);
console.log('[PATHS] GAMES_JSON:', GAMES_JSON);
console.log('[PATHS] CACHE_DIR:', CACHE_DIR);

// Helper pour obtenir le chemin correct des assets
function getAssetPath(relativePath) {
  if (isDev) {
    return relativePath; // Les chemins relatifs fonctionnent en dev
  } else {
    // En production, les assets sont dans le dossier de l'app
    return path.join(RESOURCES_PATH, 'ui', relativePath).replace(/\\/g, '/');
  }
}

let allGames = [];
let activeFilter = 'all';

// ————— Noms plateformes (affichage) ——————————
const PLATFORM_NAMES = {
  steam: 'Steam',
  epic: 'Epic Games Store',
  mstore: 'Microsoft Store',
  bnet: 'Battle.net',
  riot: 'Riot Games',
  gog: 'GOG Galaxy',
  ea: 'Electronic Arts',
  ubi: 'Ubisoft Connect',
  starcitizen: 'Cloud Imperium Games',
  rockstar: 'Rockstar Games',
};

// ————— Helpers UI —————————————————————
function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast') || createToast();
  const span = document.getElementById('toast-message');
  span.textContent = message;
  toast.classList.remove('hidden', 'show');
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, duration);
}
function createToast() {
  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.className = 'hidden';
  const span = document.createElement('span');
  span.id = 'toast-message';
  toast.appendChild(span);
  document.body.appendChild(toast);
  return toast;
}
function showLoader() {
  const el = document.getElementById('loader');
  if (!el) return;
  el.classList.remove('hidden');
  el.style.display = 'flex';
  el.style.opacity = '1';
  el.style.pointerEvents = 'all';
}
function hideLoader() {
  const el = document.getElementById('loader');
  if (!el) return;
  el.classList.add('hidden');
  el.style.display = 'none';
}

function updateHeaderOffset() {
  const header = document.querySelector('header');
  const pf = document.querySelector('.platformfilter');
  const h = header ? header.getBoundingClientRect().height : 72;
  const ph = pf ? pf.getBoundingClientRect().height : 65;
  document.documentElement.style.setProperty('--header-height', `${Math.ceil(h)}px`);
  document.documentElement.style.setProperty('--pf-height', `${Math.ceil(ph)}px`);
}

// ————— Gestion d'état SCAN robuste ——————————
let isScanning = false;
let scanTimer = null;
let watchingGames = false;

function setScanningUI(on) {
  const btn = document.getElementById('refresh-button');
  isScanning = on;

  if (btn) {
    btn.disabled = on;
    btn.textContent = on ? 'Scanning…' : 'Start scan';
    btn.setAttribute('aria-busy', String(on));
    btn.classList.toggle('is-scanning', on);
  }

  const idsToToggle = ['search-input', 'sort-select', 'grid-button', 'list-button'];
  idsToToggle.forEach(id => { const el = document.getElementById(id); if (el) el.disabled = on; });
  document.querySelectorAll('.filter-btn, #nav-library, #nav-favorites, #settings-button, #feedback-button')
    .forEach(el => { if (on) { el.setAttribute('disabled','true'); el.classList.add('disabled'); } else { el.removeAttribute('disabled'); el.classList.remove('disabled'); } });

  document.body.classList.toggle('is-scanning', on);
  if (on) showLoader(); else hideLoader();
}

function startGamesWatcher(onChangeOnce) {
  try {
    if (watchingGames) return;
    const dir = path.dirname(GAMES_JSON);
    if (!fs.existsSync(dir)) return;
    fs.watchFile(GAMES_JSON, { interval: 1000 }, () => {
      try {
        fs.accessSync(GAMES_JSON, fs.constants.R_OK);
        fs.unwatchFile(GAMES_JSON);
        watchingGames = false;
        onChangeOnce && onChangeOnce();
      } catch (_) {}
    });
    watchingGames = true;
  } catch (e) { console.warn('[Watcher] init error:', e); }
}
function stopGamesWatcher() { try { fs.unwatchFile(GAMES_JSON); } catch {} watchingGames = false; }
function endScan() { 
  if (scanTimer) { 
    clearTimeout(scanTimer); 
    scanTimer = null; 
  } 
  stopGamesWatcher(); 
  
  // Attendre un peu avant de cacher le loader pour permettre aux utilisateurs de voir le 100%
  setTimeout(() => {
    setScanningUI(false);
    console.log('[SCAN] Scan ended, UI reset');
  }, 1000);
}

// ————— Scroll horizontal ——————————
function setupPlatformFilterScroll() {
  const pf = document.querySelector('.platformfilter');
  if (!pf) return;
  updateHeaderOffset();
  window.addEventListener('resize', updateHeaderOffset);
  pf.tabIndex = 0;
  pf.addEventListener('wheel', (e) => {
    if (e.ctrlKey) return;
    const base = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    let deltaPx;
    switch (e.deltaMode) { case 0: deltaPx = base; break; case 1: deltaPx = base * 16; break; case 2: deltaPx = base * window.innerHeight; break; default: deltaPx = base; }
    const move = deltaPx * (e.shiftKey ? 2.2 : 1.2);
    const atStart = pf.scrollLeft <= 0;
    const atEnd = Math.ceil(pf.scrollLeft + pf.clientWidth) >= pf.scrollWidth;
    if ((move < 0 && !atStart) || (move > 0 && !atEnd)) { e.preventDefault(); e.stopPropagation(); pf.scrollLeft += move; }
  }, { passive: false });

  let isDown = false, startX = 0, startScroll = 0;
  const isFilterButton = (t) => !!t.closest?.('.filter-btn');
  const onPointerDown = (e) => { if (isFilterButton(e.target)) return; isDown = true; startX = e.clientX ?? (e.touches?.[0]?.clientX || 0); startScroll = pf.scrollLeft; pf.classList.add('grabbing'); };
  const onPointerMove = (e) => { if (!isDown) return; const x = e.clientX ?? (e.touches?.[0]?.clientX || 0); pf.scrollLeft = startScroll - (x - startX); };
  const onPointerUp = () => { isDown = false; pf.classList.remove('grabbing'); };
  pf.addEventListener('pointerdown', onPointerDown);
  pf.addEventListener('pointermove', onPointerMove);
  pf.addEventListener('pointerup', onPointerUp);
  pf.addEventListener('pointercancel', onPointerUp);
  pf.addEventListener('touchstart', (e) => onPointerDown(e), { passive: true });
  pf.addEventListener('touchmove', (e) => onPointerMove(e), { passive: true });
  pf.addEventListener('touchend', onPointerUp);
  pf.addEventListener('keydown', (e) => { const step = 80; if (e.key === 'ArrowLeft') { e.preventDefault(); pf.scrollLeft -= step; } if (e.key === 'ArrowRight') { e.preventDefault(); pf.scrollLeft += step; } });
}

// ————— Image Cache ————————————————————
function downloadImage(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode === 200) { res.pipe(file); file.on('finish', () => file.close(resolve)); }
      else { fs.unlink(dest, () => { }); reject(new Error(`HTTP ${res.statusCode}`)); }
    }).on('error', err => { fs.unlink(dest, () => { }); reject(err); });
  });
}
async function fetchGameImage(game, timeout = 3000) {
  const fileName = `${game.platform}_${game.appid}.jpg`;
  const localPath = path.join(CACHE_DIR, fileName);
  
  // Si l'image est déjà en cache, vérifier qu'elle n'est pas corrompue
  if (fs.existsSync(localPath)) {
    try {
      const stats = fs.statSync(localPath);
      // Vérifier que le fichier n'est pas vide ou trop petit
      if (stats.size > 1024) { // Au moins 1KB
        console.log('[IMAGE] Using cached image for', game.name);
        // Mettre à jour la date de modification pour le cache LRU
        fs.utimesSync(localPath, new Date(), new Date());
        return pathToFileURL(localPath).href;
      } else {
        console.log('[IMAGE] Cached image too small, re-downloading for', game.name);
        fs.unlinkSync(localPath); // Supprimer le fichier corrompu
      }
    } catch (e) {
      console.warn('[IMAGE] Error checking cached image for', game.name, ':', e);
      try {
        fs.unlinkSync(localPath); // Supprimer le fichier problématique
      } catch (e2) {}
    }
  }
  
  console.log('[IMAGE] Fetching image for', game.name, 'from', game.platform);
  
  try {
    // Utiliser Promise.race pour ajouter un timeout
    const result = await Promise.race([
      fetchImageWithRetry(game, localPath),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), timeout)
      )
    ]);
    return result;
  } catch (e) { 
    console.warn(`[IMAGE] Error/timeout fetching image for ${game.name}:`, e.message);
    return getAssetPath('img/placeholder.png'); // Utiliser le placeholder local
  }
}

async function fetchImageWithRetry(game, localPath, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res1 = await fetch(
        `${BASE_URL}/search/autocomplete/${encodeURIComponent(game.name)}`, 
        { 
          headers: { Authorization: `Bearer ${API_KEY}` },
          timeout: 5000
        }
      );
      const j1 = await res1.json();
      
      if (j1.success && j1.data.length) {
        const sgdbId = j1.data[0].id;
        const res2 = await fetch(
          `${BASE_URL}/grids/game/${sgdbId}?dimensions=600x900`, 
          { 
            headers: { Authorization: `Bearer ${API_KEY}` },
            timeout: 5000
          }
        );
        const j2 = await res2.json();
        
        if (j2.success && j2.data.length) { 
          await downloadImage(j2.data[0].url, localPath); 
          return pathToFileURL(localPath).href; 
        }
      }
      
      // Si pas d'image trouvée, pas besoin de retry
      break;
    } catch (e) {
      console.warn(`[IMAGE] Attempt ${attempt + 1} failed for ${game.name}:`, e.message);
      if (attempt === maxRetries) throw e;
      // Attendre un peu avant de réessayer
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return getAssetPath('img/placeholder.png');
}

// ————— Favorites —————————————————————
function getFavorites() { return JSON.parse(localStorage.getItem('favorites') || '[]'); }
function toggleFavorite(appid) { let fav = getFavorites(); fav = fav.includes(appid) ? fav.filter(id => id !== appid) : [...fav, appid]; localStorage.setItem('favorites', JSON.stringify(fav)); showToast(fav.includes(appid) ? 'Ajouté aux favoris' : 'Retiré des favoris'); sortAndRender(); }

// ————— Vue Grid/List ——————————
function setView(view) {
  const cont = document.getElementById('game-container');
  const wrap = document.getElementById('game-container-wrapper');
  const grid = document.getElementById('grid-button');
  const list = document.getElementById('list-button');
  const isList = view === 'list';
  cont?.classList.toggle('list-view', isList);
  wrap?.classList.toggle('list-view', isList);
  grid?.classList.toggle('active', !isList);
  list?.classList.toggle('active', isList);
  grid?.setAttribute('aria-pressed', String(!isList));
  list?.setAttribute('aria-pressed', String(isList));
}

function findRsiLauncher() {
  const candidates = [
    'C:\\Program Files\\Roberts Space Industries\\StarCitizen\\LIVE\\StarCitizen_Launcher.exe'
  ];
  for (const p of candidates) { try { if (fs.existsSync(p)) return p; } catch {} }
  return null;
}

// ————— LANCEMENT ——————————
function launchGame(g) {
  if (!g) return showToast('Infos de lancement manquantes (appid/execPath)');
  switch (g.platform) {
    case 'steam': shell.openExternal(`steam://run/${g.appid}`); showToast('Lancement…'); return;
    case 'epic': shell.openExternal(`com.epicgames.launcher://apps/${g.appid}?action=launch&silent=true`); showToast('Lancement…'); return;
  }
  let exe = g.executable || g.execPath;
  if (!exe && g.platform === 'starcitizen') exe = findRsiLauncher();
  if (exe && fs.existsSync(exe)) { shell.openPath(exe); showToast('Lancement…'); return; }
  showToast('Exécutable introuvable');
}

// ————— Fonction centralisée pour ajouter des cartes ——————————
function addCardToContainer(container, card) {
  // Vérifier qu'une carte avec le même appid n'existe pas déjà
  const appid = card.getAttribute('data-appid');
  const existingCard = container.querySelector(`[data-appid="${appid}"]`);
  
  if (!existingCard) {
    container.appendChild(card);
    return true;
  } else {
    console.log('[RENDER] Skipping duplicate card for appid:', appid);
    return false;
  }
}

// ————— Render Games ———————————————————
async function renderGames(games) {
  // Vérifier si un rendu est déjà en cours
  if (isRendering) {
    console.log('[RENDER] Render already in progress, aborting previous render');
    if (currentRenderAbortController) {
      currentRenderAbortController.abort();
    }
    // Annuler tous les timers en attente
    pendingCardTimers.forEach(timer => clearTimeout(timer));
    pendingCardTimers = [];
  }
  
  isRendering = true;
  currentRenderAbortController = new AbortController();
  
  const container = document.getElementById('game-container');
  const prog = document.getElementById('progress-indicator');
  if (!container || !prog) {
    isRendering = false;
    return console.error('Missing #game-container or #progress-indicator');
  }

  const visible = Array.isArray(games) ? games : [];
  
  // Vider complètement le container et supprimer tous les listeners
  const existingCards = container.querySelectorAll('.game-card');
  existingCards.forEach(card => {
    card.removeEventListener('click', card._launchHandler);
    card.querySelector('.favorite-btn')?.removeEventListener('click', card._favHandler);
  });
  container.innerHTML = '';
  
  prog.classList.remove('hidden');
  prog.textContent = `Chargement des jeux : 0 / ${visible.length}`;

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `<p>No games for this filter</p>`;
    container.appendChild(empty);
    prog.textContent = `🎮 0 jeux affichés / ${allGames.length} installés`;
    isRendering = false;
    return;
  }

  const frag = document.createDocumentFragment();
  for (let i = 0; i < visible.length; i++) {
    const g = visible[i];
    if (i === 0 || i === visible.length - 1 || i % 5 === 0) { prog.textContent = `Chargement des jeux : ${i + 1} / ${visible.length}`; }
    const cover = await fetchGameImage(g);
    const isFav = getFavorites().includes(g.appid);
    const card = document.createElement('div');
    card.className = 'game-card';
    card.setAttribute('data-appid', g.appid);
    card.setAttribute('data-platform', g.platform);
    card.innerHTML = `
      <div class="header">
        <img src="${getAssetPath('img/icon-' + g.platform + '.png')}" alt="${g.platform}" />
        <span class="platform-label">${PLATFORM_NAMES[g.platform] || g.platform}</span>
        <button class="favorite-btn ${isFav ? 'favorited' : ''}" data-appid="${g.appid}" aria-label="Toggle favorite" title="Toggle favorite">★</button>
      </div>
      <div class="cover">
        <img src="${cover}" alt="${g.name}" loading="lazy" />
      </div>
      <div class="game-title" title="${g.name}">${g.name}</div>
      <button class="play-button" aria-label="Launch ${g.name}" title="Launch">LAUNCH</button>
    `;
    const favBtn = card.querySelector('.favorite-btn');
    favBtn.onclick = (e) => { e.stopPropagation(); toggleFavorite(g.appid); };
    card.querySelector('.play-button').onclick = () => launchGame(g);
    frag.appendChild(card);
  }
  container.appendChild(frag);
  prog.textContent = `🎮 ${visible.length} jeux affichés / ${allGames.length} installés`;
  isRendering = false;
}

// ————— Render Games with Visual Progress Bar ———————————————————
async function renderGamesWithProgress(games, showProgressBar = true) {
  // Vérifier si un rendu est déjà en cours
  if (isRendering) {
    console.log('[RENDER] Render with progress already in progress, aborting previous render');
    if (currentRenderAbortController) {
      currentRenderAbortController.abort();
    }
    // Annuler tous les timers en attente
    pendingCardTimers.forEach(timer => clearTimeout(timer));
    pendingCardTimers = [];
  }
  
  isRendering = true;
  currentRenderAbortController = new AbortController();
  
  const container = document.getElementById('game-container');
  const prog = document.getElementById('progress-indicator');
  
  // Éléments de la barre de progression du loader
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  const progressPlatform = document.getElementById('progress-platform');
  const progressCount = document.getElementById('progress-count');
  
  if (!container) {
    isRendering = false;
    return console.error('Missing #game-container');
  }

  const visible = Array.isArray(games) ? games : [];
  console.log('[RENDER] Starting renderGamesWithProgress with', visible.length, 'games');
  
  // Vider complètement le container et supprimer tous les listeners
  const existingCards = container.querySelectorAll('.game-card');
  existingCards.forEach(card => {
    card.removeEventListener('click', card._launchHandler);
    card.querySelector('.favorite-btn')?.removeEventListener('click', card._favHandler);
  });
  container.innerHTML = '';
  
  if (prog) {
    prog.classList.remove('hidden');
    prog.textContent = `Chargement des vignettes : 0 / ${visible.length}`;
  }
  
  if (showProgressBar && progressPlatform) {
    progressPlatform.textContent = 'Loading game images...';
  }

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `<p>No games for this filter</p>`;
    container.appendChild(empty);
    if (prog) prog.textContent = `🎮 0 jeux affichés / ${allGames.length} installés`;
    isRendering = false;
    return;
  }

  // Traiter les jeux par batch de 8 pour un chargement plus rapide
  const batchSize = 8;
  const totalBatches = Math.ceil(visible.length / batchSize);
  
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const batchStart = batchIndex * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, visible.length);
    const batch = visible.slice(batchStart, batchEnd);
    
    console.log('[RENDER] Processing batch', batchIndex + 1, '/', totalBatches, '- Games:', batch.map(g => g.name));
    
    // Charger les images du batch avec timeout individuel
    const batchPromises = batch.map(async (g, localIndex) => {
      const globalIndex = batchStart + localIndex;
      
      try {
        console.log('[RENDER] Loading image for game #' + (globalIndex + 1) + ':', g.name);
        const cover = await fetchGameImage(g, 3000); // Timeout de 3 secondes par image
        const isFav = getFavorites().includes(g.appid);
        
        const card = document.createElement('div');
        card.className = 'game-card new-game';
        card.setAttribute('data-appid', g.appid);
        card.setAttribute('data-platform', g.platform);
        card.innerHTML = `
          <div class="header">
            <img src="${getAssetPath('img/icon-' + g.platform + '.png')}" alt="${g.platform}" />
            <span class="platform-label">${PLATFORM_NAMES[g.platform] || g.platform}</span>
            <button class="favorite-btn ${isFav ? 'favorited' : ''}" data-appid="${g.appid}" aria-label="Toggle favorite" title="Toggle favorite">★</button>
          </div>
          <div class="cover">
            <img src="${cover}" alt="${g.name}" loading="lazy" />
          </div>
          <div class="game-title" title="${g.name}">${g.name}</div>
          <button class="play-button" aria-label="Launch ${g.name}" title="Launch">LAUNCH</button>
        `;
        
        const favBtn = card.querySelector('.favorite-btn');
        favBtn.onclick = (e) => { e.stopPropagation(); toggleFavorite(g.appid); };
        card.querySelector('.play-button').onclick = () => launchGame(g);
        
        console.log('[RENDER] Successfully loaded card for', g.name);
        return { card, index: globalIndex, success: true };
      } catch (error) {
        console.error('[RENDER] Failed to load game card for', g.name, ':', error);
        // Créer une carte avec placeholder même en cas d'erreur
        const isFav = getFavorites().includes(g.appid);
        const card = document.createElement('div');
        card.className = 'game-card new-game error';
        card.setAttribute('data-appid', g.appid);
        card.setAttribute('data-platform', g.platform);
        card.innerHTML = `
          <div class="header">
            <img src="${getAssetPath('img/icon-' + g.platform + '.png')}" alt="${g.platform}" />
            <span class="platform-label">${PLATFORM_NAMES[g.platform] || g.platform}</span>
            <button class="favorite-btn ${isFav ? 'favorited' : ''}" data-appid="${g.appid}" aria-label="Toggle favorite" title="Toggle favorite">★</button>
          </div>
          <div class="cover">
            <img src="img/placeholder.png" alt="${g.name}" loading="lazy" />
          </div>
          <div class="game-title" title="${g.name}">${g.name}</div>
          <button class="play-button" aria-label="Launch ${g.name}" title="Launch">LAUNCH</button>
        `;
        const favBtn = card.querySelector('.favorite-btn');
        favBtn.onclick = (e) => { e.stopPropagation(); toggleFavorite(g.appid); };
        card.querySelector('.play-button').onclick = () => launchGame(g);
        return { card, index: globalIndex, success: false };
      }
    });
    
    // Attendre que tous les jeux du batch soient chargés avec un timeout global
    try {
      const batchResults = await Promise.race([
        Promise.all(batchPromises),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Batch timeout')), 15000) // 15s pour le batch entier
        )
      ]);
      
      console.log('[RENDER] Batch', batchIndex + 1, 'completed successfully');
      
      // Ajouter les cartes au container avec animation, en vérifiant les doublons
      batchResults.forEach(({ card, success }, i) => {
        const timer = setTimeout(() => {
          if (addCardToContainer(container, card)) {
            // Supprimer la classe d'animation après l'animation
            setTimeout(() => card.classList.remove('new-game'), 600);
          }
        }, i * 50);
        pendingCardTimers.push(timer);
      });
      
    } catch (batchError) {
      console.error('[RENDER] Batch', batchIndex + 1, 'failed:', batchError);
      // Continuer avec le batch suivant même en cas d'erreur
    }
    
    // Mettre à jour la progression
    const currentProgress = batchEnd;
    const progressPercentage = Math.round((currentProgress / visible.length) * 100);
    
    if (showProgressBar) {
      if (progressBar) progressBar.style.width = `${progressPercentage}%`;
      if (progressText) progressText.textContent = `${progressPercentage}%`;
      if (progressCount) progressCount.textContent = `${currentProgress} games loaded`;
    }
    
    if (prog) prog.textContent = `Chargement des vignettes : ${currentProgress} / ${visible.length}`;
    
    // Petit délai entre les batches pour un effet plus fluide
    if (batchIndex < totalBatches - 1) {
      await new Promise(resolve => setTimeout(resolve, 200)); // Réduit à 200ms
    }
  }
  
  // Finaliser l'affichage
  if (prog) prog.textContent = `🎮 ${visible.length} jeux affichés / ${allGames.length} installés`;
  
  if (showProgressBar) {
    if (progressBar) progressBar.style.width = '100%';
    if (progressText) progressText.textContent = '100%';
    if (progressPlatform) progressPlatform.textContent = 'All images loaded!';
    if (progressCount) progressCount.textContent = `${visible.length} games ready`;
  }
  
  isRendering = false;
}

// ————— Fonction pour normaliser les noms pour le tri ——————————
function getSortName(name) {
  // Supprimer les articles au début (anglais et français)
  const articles = /^(the|a|an|le|la|les|l'|un|une|des)\s+/i;
  let sortName = name.replace(articles, '');
  
  // Supprimer les caractères spéciaux et symboles
  sortName = sortName.replace(/[™®©]/g, '');
  
  // Supprimer les espaces multiples
  sortName = sortName.replace(/\s+/g, ' ').trim();
  
  return sortName;
}

// ————— Tri + filtre + rendu ——————————
function sortAndRender(useProgressBar = false) {
  // Débouncer les appels pour éviter les rendus multiples rapides
  if (sortAndRenderTimer) {
    clearTimeout(sortAndRenderTimer);
  }
  
  sortAndRenderTimer = setTimeout(() => {
    const searchVal = document.getElementById('search-input')?.value.toLowerCase() || '';
    const sortVal = document.getElementById('sort-select')?.value || 'AZ';
    let filtered = allGames.filter(g => {
      const byPlat = activeFilter === 'all' ? true : activeFilter === 'favorites' ? getFavorites().includes(g.appid) : g.platform === activeFilter;
      return byPlat && g.name.toLowerCase().includes(searchVal);
    });
    if (filtered.length === 0 && activeFilter !== 'all') { console.debug(`[Filter] "${activeFilter}" → 0 jeu(s). Vérifie les valeurs "platform" dans games.json.`); }
    filtered.sort((a, b) => {
      const aSortName = getSortName(a.name);
      const bSortName = getSortName(b.name);
      return sortVal.startsWith('Z') 
        ? bSortName.localeCompare(aSortName, 'fr', { sensitivity: 'base', numeric: true })
        : aSortName.localeCompare(bSortName, 'fr', { sensitivity: 'base', numeric: true });
    });
    
    console.log('[RENDER] sortAndRender called with', filtered.length, 'games, useProgressBar:', useProgressBar);
    
    // Utiliser la nouvelle fonction avec barre de progression pour de grands nombres de jeux
    if (useProgressBar || filtered.length > 20) {
      renderGamesWithProgress(filtered, false); // Pas besoin de la barre de progression du scan
    } else {
      renderGames(filtered);
    }
    
    // Forcer la mise à jour du compteur
    updateGameCounter();
    
    sortAndRenderTimer = null;
  }, 150); // Débounce de 150ms
}

// ————— Normalisation plateformes ——————————
const PLATFORM_ALIASES = {
  epicgames: 'epic', egs: 'epic',
  goggalaxy: 'gog', gog2: 'gog',
  eaapp: 'ea', origin: 'ea',
  uplay: 'ubi', ubisoft: 'ubi',
  msstore: 'mstore', microsoftstore: 'mstore', xbox: 'mstore',
  battlenet: 'bnet', blizzard: 'bnet',
  cig: 'starcitizen', sc: 'starcitizen',
  rstars: 'rockstar', rockstargames: 'rockstar',
};
function normalizePlatform(p) { if (!p) return 'all'; const key = String(p).toLowerCase().trim(); return PLATFORM_ALIASES[key] || key; }

// ————— Chargement des jeux ——————————
function loadGames(useProgressBar = false) {
  if (!fs.existsSync(GAMES_JSON)) { showToast('Aucun jeu trouvé. Lance un scan.'); return; }
  const raw = JSON.parse(fs.readFileSync(GAMES_JSON, 'utf-8'));
  allGames = raw.map(g => ({ ...g, platform: normalizePlatform(g.platform) }));
  sortAndRender(useProgressBar);
}

// ————— Filtres & interactions ——————————
function setActiveFilter(filter) {
  activeFilter = filter;
  document.querySelectorAll('.platformfilter .filter-btn').forEach(b => {
    const isActive = b.dataset.filter === filter || (filter !== 'favorites' && b.dataset.filter === 'all' && filter === 'all');
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-selected', String(isActive));
  });
  const lib = document.getElementById('nav-library');
  const fav = document.getElementById('nav-favorites');
  if (lib && fav) { const favActive = filter === 'favorites'; fav.classList.toggle('active', favActive); lib.classList.toggle('active', !favActive); if (!favActive) lib.setAttribute('aria-current','page'); else lib.removeAttribute('aria-current'); }
  sortAndRender();
}
function setupFilters() {
  const pf = document.querySelector('.platformfilter');
  if (!pf) return;
  pf.addEventListener('click', (e) => { const btn = e.target.closest('.filter-btn'); if (!btn) return; setActiveFilter(btn.dataset.filter); });
  document.getElementById('nav-library')?.addEventListener('click', () => setActiveFilter('all'));
  document.getElementById('nav-favorites')?.addEventListener('click', () => setActiveFilter('favorites'));
}
function setupSearch() { const inp = document.getElementById('search-input'); if (inp) inp.oninput = sortAndRender; }
function setupSort() { const sel = document.getElementById('sort-select'); if (sel) sel.onchange = sortAndRender; }
function setupViewToggle() { const grid = document.getElementById('grid-button'); const list = document.getElementById('list-button'); if (grid) grid.onclick = () => setView('grid'); if (list) list.onclick = () => setView('list'); }

// ————— Ajustement taille des cards ——————————
function setupCardSizeControls() {
  const sizeButtons = document.querySelectorAll('.size-btn');
  const gameContainer = document.getElementById('game-container');
  
  if (!sizeButtons.length || !gameContainer) return;
  
  // Charger la préférence sauvegardée
  const savedSize = localStorage.getItem('cardSize') || '220';
  setCardSize(parseInt(savedSize));
  
  // Mettre à jour le bouton actif selon la taille sauvegardée
  sizeButtons.forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.size === savedSize) {
      btn.classList.add('active');
    }
  });
  
  // Gérer les clics sur les boutons
  sizeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const newSize = parseInt(btn.dataset.size);
      
      // Mettre à jour les boutons actifs
      sizeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Appliquer la nouvelle taille
      setCardSize(newSize);
      
      // Sauvegarder la préférence
      localStorage.setItem('cardSize', newSize.toString());
      
      console.log(`[CARDS] Taille changée: ${newSize}px`);
    });
  });
}

function setCardSize(size) {
  const root = document.documentElement;
  root.style.setProperty('--card-w', `${size}px`);
  
  // Ajuster aussi la hauteur proportionnellement pour garder de belles proportions
  const aspectRatio = 1.4; // ratio hauteur/largeur
  const cardHeight = size * aspectRatio;
  root.style.setProperty('--card-h', `${cardHeight}px`);
}

// ————— Mise à jour ——————————
function setupUpdate() {
  const btn = document.getElementById('update-button');
  if (!btn) return;
  
  btn.onclick = async () => {
    btn.disabled = true;
    btn.innerHTML = '⏳ Checking...';
    btn.title = 'Checking for updates...';
    
    try {
      await window.require('electron').ipcRenderer.invoke('check-for-updates');
    } catch (error) {
      console.error('Erreur lors de la vérification des mises à jour:', error);
      showToast('Erreur lors de la vérification des mises à jour');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '🔄 Check for Updates';
      btn.title = 'Check for updates';
    }
  };
  
  // Ajouter la version actuelle en tooltip
  window.require('electron').ipcRenderer.invoke('get-app-version').then(version => {
    btn.title = `Check for updates (Current version: ${version})`;
  });
}
function updateProgress(percentage, platform, gamesFound) {
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  const progressPlatform = document.getElementById('progress-platform');
  const progressCount = document.getElementById('progress-count');
  
  if (progressBar) progressBar.style.width = `${percentage}%`;
  if (progressText) progressText.textContent = `${percentage}%`;
  
  if (progressPlatform) {
    if (platform === 'Terminé') {
      progressPlatform.textContent = 'Scan completed!';
    } else if (platform === 'Initialisation') {
      progressPlatform.textContent = 'Starting scan...';
    } else {
      progressPlatform.textContent = `Scanning ${platform}...`;
    }
  }
  
  if (progressCount) progressCount.textContent = `${gamesFound} games found`;
}

async function appendNewGames(newGames) {
  if (!newGames || newGames.length === 0) return;
  
  const container = document.getElementById('game-container');
  if (!container) return;
  
  // Normaliser les nouveaux jeux
  const normalizedGames = newGames.map(g => ({ ...g, platform: normalizePlatform(g.platform) }));
  
  // Vérifier les doublons avant d'ajouter (par appid et nom+plateforme)
  const existingAppIds = new Set(allGames.map(g => g.appid));
  const existingNames = new Set(allGames.map(g => `${g.name.toLowerCase()}_${g.platform}`));
  
  const uniqueGames = normalizedGames.filter(g => {
    const nameKey = `${g.name.toLowerCase()}_${g.platform}`;
    const isDuplicateById = g.appid && existingAppIds.has(g.appid);
    const isDuplicateByName = existingNames.has(nameKey);
    return !isDuplicateById && !isDuplicateByName;
  });
  
  if (uniqueGames.length === 0) {
    console.log('[SCAN] No new unique games to add');
    return;
  }
  
  // Ajouter à la liste globale
  console.log('[SCAN] Adding', uniqueGames.length, 'unique games to allGames. Current total:', allGames.length);
  allGames.push(...uniqueGames);
  console.log('[SCAN] allGames now contains', allGames.length, 'games total');
  
  // Appliquer les filtres actuels pour déterminer quels jeux afficher
  const searchVal = document.getElementById('search-input')?.value.toLowerCase() || '';
  const visibleNewGames = uniqueGames.filter(g => {
    const byPlat = activeFilter === 'all' ? true : activeFilter === 'favorites' ? getFavorites().includes(g.appid) : g.platform === activeFilter;
    return byPlat && g.name.toLowerCase().includes(searchVal);
  });
  
  // Ne pas déclencher de rendu pendant le scan pour éviter les doublons
  // Le rendu final se fera à la fin du scan complet
  console.log('[SCAN] New games added to allGames, total now:', allGames.length);
  
  // Mettre à jour le compteur
  updateGameCounter();
}

function updateGameCounter() {
  const prog = document.getElementById('progress-indicator');
  if (prog) {
    const currentlyDisplayed = document.querySelectorAll('.game-card').length;
    prog.textContent = `🎮 ${currentlyDisplayed} jeux affichés / ${allGames.length} installés`;
    // Afficher le compteur pendant le scan, le cacher s'il n'y a aucun jeu
    if (currentlyDisplayed === 0 && allGames.length === 0) {
      prog.classList.add('hidden');
    } else {
      prog.classList.remove('hidden');
    }
  }
}

function startScanProcess(executable, args = [], options = {}) {
  console.log('[SCAN] Starting process:', executable, 'with args:', args);
  const scanProcess = spawn(executable, args, {
    cwd: options.cwd || path.dirname(executable),
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    ...options
  });
  
  console.log('[SCAN] Process PID:', scanProcess.pid);
  return scanProcess;
}

function tryPythonFallback() {
  console.log('[SCAN] Trying Python fallback...');
  const pythonScript = isDev 
    ? path.join(__dirname, '..', 'scanner', 'unified_scanner.py')
    : path.join(path.dirname(process.execPath), 'resources', 'app', 'scanner', 'unified_scanner.py');
  
  if (!fs.existsSync(pythonScript)) {
    console.error('[SCAN] Python script not found:', pythonScript);
    showToast('Erreur: ni .exe ni .py trouvés');
    endScan();
    return;
  }
  
  // Essayer python, puis py (Windows)
  const pythonCommands = ['python', 'py', 'python3'];
  let commandIndex = 0;
  
  function tryNextPythonCommand() {
    if (commandIndex >= pythonCommands.length) {
      showToast('Erreur: Python non trouvé');
      endScan();
      return;
    }
    
    const pythonCmd = pythonCommands[commandIndex];
    console.log('[SCAN] Trying Python command:', pythonCmd);
    
    const scanProcess = startScanProcess(pythonCmd, [pythonScript], {
      cwd: path.dirname(pythonScript)
    });
    
    setupProcessHandlers(scanProcess, () => {
      commandIndex++;
      tryNextPythonCommand();
    });
  }
  
  tryNextPythonCommand();
}

function setupProcessHandlers(scanProcess, onErrorCallback) {
  let outputBuffer = '';
  
  scanProcess.stdout.on('data', (data) => {
    const text = data.toString();
    console.log('[SCAN] stdout data:', text.substring(0, 200) + (text.length > 200 ? '...' : ''));
    outputBuffer += text;
    
    // Traiter les messages de progression ligne par ligne
    const lines = outputBuffer.split('\n');
    outputBuffer = lines.pop() || ''; // Garder la dernière ligne incomplète
    
    for (const line of lines) {
      if (line.startsWith('PROGRESS:')) {
        try {
          const progressData = JSON.parse(line.substring(9));
          console.log('[SCAN] Progress update:', progressData.platform, progressData.percentage + '%', 'Games in message:', progressData.games?.length || 0);
          updateProgress(progressData.percentage, progressData.platform, progressData.games_found);
          
          // Si des jeux sont trouvés pour cette plateforme, les ajouter
          if (progressData.games && progressData.games.length > 0) {
            console.log('[SCAN] Adding', progressData.games.length, 'games for', progressData.platform);
            appendNewGames(progressData.games);
          } else {
            console.log('[SCAN] No games in this progress message for', progressData.platform);
          }
        } catch (e) {
          console.error('[SCAN] Error parsing progress data:', e, 'Line:', line);
        }
      } else if (line.trim() && !line.startsWith('[')) {
        console.log('[SCAN] Other output:', line);
      }
    }
  });
  
  scanProcess.stderr.on('data', (data) => {
    const stderr = data.toString();
    console.error('[SCAN] stderr:', stderr);
    // Ne pas traiter les logs normaux comme des erreurs
    if (!stderr.includes('[') && stderr.trim()) {
      console.warn('[SCAN] Potential error in stderr:', stderr);
    }
  });
  
  scanProcess.on('close', (code) => {
    console.log('[SCAN] Process closed with code:', code);
    if (code === 0) {
      try {
        console.log('[SCAN] Scan completed successfully, starting image loading phase...');
        console.log('[SCAN] allGames contains', allGames.length, 'games after scan');
        console.log('[SCAN] Sample games:', allGames.slice(0, 3).map(g => g.name));
        
        // Les jeux ont déjà été ajoutés progressivement via appendNewGames
        // Plus besoin de re-render, juste finaliser le scan
        console.log('[SCAN] Scan completed with', allGames.length, 'total games loaded');
        
        // Ne pas recharger depuis JSON car les jeux ont été ajoutés progressivement
        // Cette section était source de doublons lors des rescans
        console.log('[SCAN] Final games count:', allGames.length, '- Skipping JSON reload to prevent duplicates');
        
        // Faire UN SEUL rendu final avec tous les jeux
        console.log('[SCAN] Triggering final render with all games');
        sortAndRender(false);
        
        // Finaliser avec un toast et terminer le scan
        showToast('Scan terminé avec succès - ' + allGames.length + ' jeux trouvés');
        endScan();
        
      } catch (e) {
        console.error('[SCAN] Post-scan processing failed:', e);
        showToast('Erreur lors du traitement post-scan');
        endScan();
      }
    } else {
      console.error('[SCAN] Scanner process exited with code:', code);
      if (onErrorCallback) {
        onErrorCallback();
      } else {
        showToast('Erreur lors de l\'analyse (code: ' + code + ')');
        endScan();
      }
    }
  });
  
  scanProcess.on('error', (err) => {
    console.error('[SCAN] Scanner process error:', err);
    if (onErrorCallback) {
      onErrorCallback();
    } else {
      showToast('Erreur lors du démarrage de l\'analyse: ' + err.message);
      endScan();
    }
  });
  
  scanProcess.on('spawn', () => {
    console.log('[SCAN] Process spawned successfully');
  });
  
  // Timeout de sécurité
  scanTimer = setTimeout(() => {
    console.warn('[SCAN] timeout reached, ending scanning state.');
    scanProcess.kill();
    showToast('Analyse interrompue (timeout)');
    endScan();
  }, 180000);
}

function setupRefresh() {
  const btn = document.getElementById('refresh-button');
  if (!btn) return;
  btn.onclick = () => {
    console.log('[SCAN] Button clicked, starting scan...');
    
    function getScannerPath() {
      if (isDev) {
        return path.join(__dirname, '..', 'scanner', 'unified_scanner.exe');
      } else {
        // Essayer plusieurs emplacements possibles dans l'app packagée
        const execDir = path.dirname(process.execPath);
        const possiblePaths = [
          path.join(RESOURCES_PATH, 'scanner', 'unified_scanner.exe'),
          path.join(execDir, 'resources', 'scanner', 'unified_scanner.exe'), // extraResources
          path.join(execDir, 'resources', 'app', 'scanner', 'unified_scanner.exe'), // ASAR disabled
          path.join(execDir, 'scanner', 'unified_scanner.exe'), // Direct
          path.join(process.resourcesPath, 'scanner', 'unified_scanner.exe'),
          path.join(process.resourcesPath, 'app', 'scanner', 'unified_scanner.exe')
        ];
        
        for (const scannerPath of possiblePaths) {
          if (fs.existsSync(scannerPath)) {
            console.log('[SCAN] Found scanner at:', scannerPath);
            return scannerPath;
          }
        }
        
        console.error('[SCAN] Scanner not found in any of these paths:', possiblePaths);
        return possiblePaths[0]; // Return first path as fallback
      }
    }
    
    const exe = getScannerPath();
    
    console.log('[SCAN] Executable path:', exe);
    console.log('[SCAN] isDev:', isDev);
    console.log('[SCAN] Executable exists:', fs.existsSync(exe));
    
    // Réinitialiser complètement l'interface et l'état
    console.log('[SCAN] Clearing previous state...');
    console.log('[SCAN] Previous allGames length:', allGames.length);
    
    // Annuler tous les timers pendants d'abord
    pendingCardTimers.forEach(timer => clearTimeout(timer));
    pendingCardTimers = [];
    
    // Vider le tableau de jeux
    allGames.length = 0;
    
    // Vider complètement le container DOM
    const container = document.getElementById('game-container');
    if (container) {
      // Supprimer tous les listeners d'événements existants
      const existingCards = container.querySelectorAll('.game-card');
      existingCards.forEach(card => {
        card.removeEventListener('click', card._launchHandler);
        card.querySelector('.favorite-btn')?.removeEventListener('click', card._favHandler);
      });
      container.innerHTML = '';
      // Forcer le reflow pour éviter les problèmes d'affichage
      container.offsetHeight;
    }
    console.log('[SCAN] State cleared, allGames length now:', allGames.length);
    
    // Réinitialiser les compteurs et indicateurs
    updateGameCounter();
    
    // Réinitialiser les éléments de progression
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    const progressPlatform = document.getElementById('progress-platform');
    const progressCount = document.getElementById('progress-count');
    const progressIndicator = document.getElementById('progress-indicator');
    
    if (progressBar) progressBar.style.width = '0%';
    if (progressText) progressText.textContent = '0%';
    if (progressPlatform) progressPlatform.textContent = 'Starting scan...';
    if (progressCount) progressCount.textContent = '0 games found';
    if (progressIndicator) progressIndicator.classList.add('hidden');
    
    setScanningUI(true);
    
    // Essayer le .exe d'abord, puis Python en fallback
    if (fs.existsSync(exe)) {
      console.log('[SCAN] Using .exe file');
      const scanProcess = startScanProcess(exe);
      setupProcessHandlers(scanProcess, () => {
        console.log('[SCAN] .exe failed, trying Python fallback...');
        tryPythonFallback();
      });
    } else {
      console.log('[SCAN] .exe not found, using Python fallback');
      tryPythonFallback();
    }
  };
}

// ————— Initialize ————————————————————
window.addEventListener('DOMContentLoaded', () => {
  // UI wiring
  setupFilters();
  setupSearch();
  setupSort();
  setupViewToggle();
  setupRefresh();
  setupUpdate();
  setupCardSizeControls();
  setupPlatformFilterScroll();

  // Data
  setActiveFilter('all');
  // Charger automatiquement les jeux au démarrage pour afficher le cache
  loadGames();
});
