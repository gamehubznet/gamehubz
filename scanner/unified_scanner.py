#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GameHUBZ Unified Scanner - Version 2.0
Scanner unifié pour toutes les plateformes de jeux avec détection multi-disques.
Remplace tous les scanners individuels par un système centralisé et optimisé.
"""

import os
import sys
import json
import time
import string
import ctypes
import winreg
import traceback
import concurrent.futures
from typing import Dict, List, Tuple, Callable, Optional
import vdf
import requests
import urllib.parse

# Configuration UTF-8
sys.stdout.reconfigure(encoding='utf-8')

# Version du scanner
SCANNER_VERSION = "2.0.0"

# Configuration des plateformes
PLATFORMS = {
    'steam': {'name': 'Steam', 'priority': 1},
    'epic': {'name': 'Epic Games Store', 'priority': 1}, 
    'riot': {'name': 'Riot Games', 'priority': 1},
    'starcitizen': {'name': 'Cloud Imperium Games', 'priority': 1},
    'ea': {'name': 'Electronic Arts', 'priority': 2},
    'ubi': {'name': 'Ubisoft Connect', 'priority': 2},
    'bnet': {'name': 'Battle.net', 'priority': 2},
    'rockstar': {'name': 'Rockstar Games', 'priority': 2},
    'gog': {'name': 'GOG Galaxy', 'priority': 3},
    'mstore': {'name': 'Microsoft Store', 'priority': 3}
}

# API pour les images
STEAMGRIDDB_API = '7a16155f1842fd8ee0b46f681fd5a207'
STEAMGRIDDB_URL = 'https://www.steamgriddb.com/api/v2'

class UnifiedGameScanner:
    """Scanner unifié pour toutes les plateformes de jeux"""
    
    def __init__(self, progress_callback=None):
        self.progress_callback = progress_callback
        self.all_games = []
        self.drives = []
        self.scan_stats = {
            'total_games': 0,
            'scan_time': 0,
            'platforms_found': 0
        }
        
        # Blacklists par plateforme (améliorées)
        self.blacklists = {
            'steam': ["redistributable", "steamworks", "vr", "runtime", "proton",
                     "shader", "soundtrack", "server", "tools", "workshop", "editor", "benchmark"],
            'epic': ["plugin", "unreal", "engine", "riderlink", "sample", "datasmith", "mod", "tool",
                    "bridge", "launcher", "editor", "project", "template", "asset", "assets", "content", "example",
                    "directxredist", "directx", "ue_", "epic online services", "services"],
            'ea': ["plugin", "unreal", "engine", "riderlink", "sample", "datasmith", "mod", "tool", "setup", "uninstall"],
            'ubi': ["uplay", "launcher", "integration", "setup", "uninstall"],
            'bnet': ["battle.net", "launcher", "agent", "update", "tool"],
            'riot': ["riot client", "riotclient", "uninstall", "service", "tools"],
            'rockstar': ["launcher", "social club", "socialclub", "updater", "installer"],
            'gog': ["setup", "install", "installer", "uninstall", "uninstaller", "redist", "redistributable",
                   "commonredist", "common_redist", "directx", "dxredist", "dxsetup", "vcredist", "vc_redist",
                   "runtime", "mono", "framework", "launcher", "galaxyclient", "galaxy", "tools", "tool"]
        }
        
    def send_progress(self, platform: str, percentage: int, games_found: int = 0, platform_games: List = None):
        """Envoie un message de progression"""
        if self.progress_callback:
            self.progress_callback(platform, percentage, games_found, platform_games or [])
        else:
            progress_data = {
                "type": "progress",
                "platform": platform,
                "percentage": percentage,
                "games_found": games_found,
                "games": platform_games or []
            }
            progress_line = "PROGRESS:" + json.dumps(progress_data, ensure_ascii=False)
            print(progress_line)
            sys.stdout.flush()
    
    def get_all_drives(self) -> List[str]:
        """Récupère tous les lecteurs disponibles sur le système Windows"""
        drives = []
        try:
            bitmask = ctypes.cdll.kernel32.GetLogicalDrives()
            for letter in string.ascii_uppercase:
                if bitmask & 1:
                    drives.append(f"{letter}:\\")
                bitmask >>= 1
        except Exception as e:
            print(f"[UNIFIED] Erreur lors de la détection des lecteurs: {e}")
            drives = ['C:\\', 'D:\\', 'E:\\', 'F:\\']
        
        # Optimiser l'ordre de scan (C: en premier, puis par espace libre)
        priority_drives = ['C:\\']
        other_drives = [d for d in drives if d not in priority_drives and os.path.exists(d)]
        
        return priority_drives + other_drives
    
    def get_drive_info(self) -> Dict[str, Dict]:
        """Récupère des informations sur tous les disques"""
        drives = self.get_all_drives()
        info = {}
        
        for drive in drives:
            try:
                free_space = ctypes.c_ulonglong()
                total_space = ctypes.c_ulonglong()
                
                ctypes.windll.kernel32.GetDiskFreeSpaceExW(
                    ctypes.c_wchar_p(drive),
                    ctypes.pointer(free_space),
                    ctypes.pointer(total_space),
                    None
                )
                
                info[drive] = {
                    'free_gb': free_space.value / (1024**3),
                    'total_gb': total_space.value / (1024**3),
                    'accessible': True
                }
            except Exception:
                info[drive] = {'free_gb': 0, 'total_gb': 0, 'accessible': False}
        
        return info
    
    def find_exe_in_directory(self, directory: str, blacklist: List[str] = None) -> Optional[str]:
        """Trouve le premier exécutable valide dans un dossier"""
        if not os.path.exists(directory):
            return None
        
        blacklist = blacklist or []
        
        try:
            for root, _, files in os.walk(directory):
                for f in files:
                    if f.lower().endswith(".exe") and "uninstall" not in f.lower():
                        if not any(kw in f.lower() for kw in blacklist):
                            return os.path.join(root, f)
        except OSError:
            pass
        
        return None
    
    def is_blacklisted(self, name: str, platform: str) -> bool:
        """Vérifie si un nom est dans la blacklist"""
        blacklist = self.blacklists.get(platform, [])
        return any(kw in name.lower() for kw in blacklist)
    
    def deduplicate_games(self, games: List[Dict]) -> List[Dict]:
        """Supprime les doublons basés sur le nom, appid et plateforme"""
        seen = set()
        unique_games = []
        
        for game in games:
            name = game.get('name', '').strip()
            appid = game.get('appid', '')
            platform = game.get('platform', '')
            
            # Normaliser le nom pour la comparaison
            normalized_name = name.lower().replace(' ', '').replace('-', '').replace('_', '')
            
            # Créer plusieurs clés pour détecter différents types de doublons
            keys = [
                f"{normalized_name}_{platform}",  # Nom normalisé + plateforme
                f"{appid}_{platform}" if appid else None,  # AppID + plateforme (si appid existe)
                f"{name.lower()}_{platform}"  # Nom exact + plateforme
            ]
            
            # Enlever les clés vides
            keys = [k for k in keys if k and k != "_"]
            
            # Vérifier si une des clés existe déjà
            is_duplicate = any(key in seen for key in keys)
            
            if not is_duplicate:
                # Ajouter toutes les clés valides
                for key in keys:
                    seen.add(key)
                unique_games.append(game)
            else:
                print(f"[UNIFIED] Doublon supprimé: {name} ({platform})")
        
        return unique_games
    
    def is_valid_game(self, name: str, executable_path: str = None) -> bool:
        """Vérifie si c'est un vrai jeu et pas un outil"""
        name_lower = name.lower()
        
        # Liste globale de mots-clés qui indiquent que ce n'est PAS un jeu
        global_blacklist = [
            "directx", "redist", "redistributable", "vcredist", "vc_redist",
            "launcher", "updater", "installer", "uninstall", "setup",
            "service", "agent", "helper", "browser", "client",
            "engine", "editor", "tool", "plugin", "mod",
            "runtime", "framework", "sdk", "api",
            "crash", "reporter", "analytics", "telemetry",
            "social club", "epic online services"
        ]
        
        # Vérifier si le nom contient des mots-clés non-jeu
        if any(keyword in name_lower for keyword in global_blacklist):
            return False
        
        # Patterns spécifiques à éviter
        bad_patterns = [
            "ue_",  # Unreal Engine
            "_redist",
            "_runtime",
            "_launcher"
        ]
        
        if any(pattern in name_lower for pattern in bad_patterns):
            return False
        
        # Si on a un chemin d'exécutable, vérifier qu'il ne contient pas de mots suspects
        if executable_path:
            exe_lower = executable_path.lower()
            exe_blacklist = ["setup.exe", "uninstall", "launcher.exe", "updater.exe", "service.exe"]
            if any(bad_exe in exe_lower for bad_exe in exe_blacklist):
                return False
        
        return True
    
    # ==================== STEAM SCANNER ====================
    def scan_steam(self) -> List[Dict]:
        """Scanner Steam sur tous les disques"""
        games = []
        steam_paths = []
        
        print("[UNIFIED] Scan Steam...")
        
        # Chercher Steam sur tous les disques
        for drive in self.drives:
            potential_paths = [
                os.path.join(drive, "Program Files (x86)", "Steam"),
                os.path.join(drive, "Program Files", "Steam"),
                os.path.join(drive, "Steam"),
                os.path.join(drive, "SteamLibrary"),
                os.path.join(drive, "Games", "Steam")
            ]
            
            for path in potential_paths:
                steamapps = os.path.join(path, "steamapps")
                if os.path.exists(steamapps):
                    steam_paths.append(steamapps)
                    
                    # Lire libraryfolders.vdf pour trouver d'autres bibliothèques
                    libvdf = os.path.join(steamapps, "libraryfolders.vdf")
                    if os.path.exists(libvdf):
                        try:
                            with open(libvdf, encoding="utf-8") as f:
                                data = vdf.load(f)
                            
                            for entry in data.get("libraryfolders", {}).values():
                                if isinstance(entry, dict):
                                    p = entry.get("path")
                                else:
                                    p = entry
                                
                                if p:
                                    sp = os.path.join(p, "steamapps")
                                    if os.path.exists(sp) and sp not in steam_paths:
                                        steam_paths.append(sp)
                        except Exception:
                            continue
        
        # Scanner toutes les bibliothèques Steam trouvées
        for libs in steam_paths:
            try:
                for fn in os.listdir(libs):
                    if fn.startswith("appmanifest") and fn.endswith(".acf"):
                        try:
                            with open(os.path.join(libs, fn), encoding="utf-8") as f:
                                acf = vdf.load(f)
                            
                            st = acf["AppState"]
                            appid, name = st["appid"], st["name"]
                            
                            if not self.is_blacklisted(name, 'steam'):
                                games.append({
                                    "appid": appid,
                                    "name": name,
                                    "platform": "steam"
                                })
                        except Exception:
                            continue
            except OSError:
                continue
        
        print(f"[UNIFIED] Steam: {len(games)} jeux trouvés")
        return games
    
    # ==================== EPIC GAMES SCANNER ====================
    def scan_epic(self) -> List[Dict]:
        """Scanner Epic Games Store sur tous les disques"""
        games = []
        
        print("[UNIFIED] Scan Epic Games Store...")
        
        # Méthode 1: Scanner les manifestes
        manifests_path = r"C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests"
        if os.path.exists(manifests_path):
            try:
                for fn in os.listdir(manifests_path):
                    if fn.endswith(".item"):
                        try:
                            with open(os.path.join(manifests_path, fn), encoding="utf-8") as f:
                                data = json.load(f)
                            
                            appid = data.get("AppName")
                            name = data.get("DisplayName")
                            path_game = data.get("InstallLocation")
                            
                            if (appid and name and path_game and os.path.exists(path_game) 
                                and not self.is_blacklisted(name, 'epic')
                                and self.is_valid_game(name)):
                                games.append({
                                    "appid": appid,
                                    "name": name,
                                    "platform": "epic"
                                })
                        except Exception:
                            continue
            except OSError:
                pass
        
        # Méthode 2: Scanner les dossiers Epic Games sur tous les disques
        # Créer un set avec les noms normalisés pour éviter les doublons
        seen_names_normalized = set()
        for game in games:
            name = game.get('name', '')
            # Normaliser : lowercase, sans espaces, sans caractères spéciaux
            normalized = name.lower().replace(' ', '').replace('-', '').replace('_', '').replace('™', '')
            seen_names_normalized.add(normalized)
        
        for drive in self.drives:
            epic_paths = [
                os.path.join(drive, "Program Files", "Epic Games"),
                os.path.join(drive, "Program Files (x86)", "Epic Games"),
                os.path.join(drive, "Epic Games"),
                os.path.join(drive, "Games", "Epic Games")
            ]
            
            for path in epic_paths:
                if not os.path.exists(path):
                    continue
                
                try:
                    for game_dir in os.listdir(path):
                        game_path = os.path.join(path, game_dir)
                        if not os.path.isdir(game_path):
                            continue
                        
                        # Normaliser le nom du dossier pour comparaison
                        game_dir_normalized = game_dir.lower().replace(' ', '').replace('-', '').replace('_', '').replace('™', '')
                        
                        if (self.is_blacklisted(game_dir, 'epic') or 
                            not self.is_valid_game(game_dir) or
                            game_dir_normalized in seen_names_normalized):
                            continue
                        
                        exe_path = self.find_exe_in_directory(game_path, self.blacklists['epic'])
                        if exe_path and self.is_valid_game(game_dir, exe_path):
                            games.append({
                                "appid": game_dir.replace(" ", ""),
                                "name": game_dir,
                                "platform": "epic",
                                "executable": exe_path
                            })
                            seen_names.add(game_dir.lower())
                except OSError:
                    continue
        
        print(f"[UNIFIED] Epic: {len(games)} jeux trouvés")
        return games
    
    # ==================== EA SCANNER ====================
    def scan_ea(self) -> List[Dict]:
        """Scanner EA/Origin sur tous les disques"""
        games = []
        
        print("[UNIFIED] Scan EA/Origin...")
        
        for drive in self.drives:
            ea_paths = [
                os.path.join(drive, "Program Files (x86)", "Origin Games"),
                os.path.join(drive, "Program Files", "EA Games"),
                os.path.join(drive, "Program Files (x86)", "EA Games"),
                os.path.join(drive, "Origin Games"),
                os.path.join(drive, "EA Games"),
                os.path.join(drive, "Games", "Origin"),
                os.path.join(drive, "Games", "EA")
            ]
            
            for path in ea_paths:
                if not os.path.exists(path):
                    continue
                
                try:
                    for name in os.listdir(path):
                        game_dir = os.path.join(path, name)
                        if not os.path.isdir(game_dir):
                            continue
                        
                        if self.is_blacklisted(name, 'ea'):
                            continue
                        
                        exe_path = self.find_exe_in_directory(game_dir, self.blacklists['ea'])
                        if exe_path:
                            games.append({
                                "appid": name,
                                "name": name,
                                "platform": "ea",
                                "executable": exe_path
                            })
                except OSError:
                    continue
        
        print(f"[UNIFIED] EA: {len(games)} jeux trouvés")
        return games
    
    # ==================== UBISOFT SCANNER ====================
    def scan_ubisoft(self) -> List[Dict]:
        """Scanner Ubisoft Connect sur tous les disques"""
        games = []
        seen_games = set()
        
        print("[UNIFIED] Scan Ubisoft Connect...")
        
        for drive in self.drives:
            ubi_paths = [
                os.path.join(drive, "Program Files (x86)", "Ubisoft", "Ubisoft Game Launcher", "games"),
                os.path.join(drive, "Program Files", "Ubisoft", "Ubisoft Game Launcher", "games"),
                os.path.join(drive, "Games", "Ubisoft"),
                os.path.join(drive, "Games", "Ubisoft Games"),
                os.path.join(drive, "Ubisoft Games")
            ]
            
            for path in ubi_paths:
                if not os.path.exists(path):
                    continue
                
                try:
                    for name in os.listdir(path):
                        if name in seen_games or self.is_blacklisted(name, 'ubi'):
                            continue
                        
                        game_dir = os.path.join(path, name)
                        if not os.path.isdir(game_dir):
                            continue
                        
                        exe_path = self.find_exe_in_directory(game_dir, self.blacklists['ubi'])
                        if exe_path:
                            games.append({
                                "appid": name,
                                "name": name.replace("_", " "),
                                "platform": "ubi",
                                "executable": exe_path
                            })
                            seen_games.add(name)
                except OSError:
                    continue
        
        print(f"[UNIFIED] Ubisoft: {len(games)} jeux trouvés")
        return games
    
    # ==================== BATTLE.NET SCANNER ====================
    def scan_battlenet(self) -> List[Dict]:
        """Scanner Battle.net sur tous les disques"""
        games = []
        seen_games = set()
        
        print("[UNIFIED] Scan Battle.net...")
        
        # Méthode 1: Scanner via le registre
        roots = [
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
            (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        ]

        for hive, subkey in roots:
            try:
                with winreg.OpenKey(hive, subkey) as ukey:
                    for i in range(winreg.QueryInfoKey(ukey)[0]):
                        try:
                            sk = winreg.EnumKey(ukey, i)
                            with winreg.OpenKey(ukey, sk) as app:
                                name = winreg.QueryValueEx(app, "DisplayName")[0]
                                publisher = winreg.QueryValueEx(app, "Publisher")[0]
                                loc = winreg.QueryValueEx(app, "InstallLocation")[0]
                        except FileNotFoundError:
                            continue
                        except Exception:
                            continue

                        if (not name or not loc or 
                            "blizzard entertainment" not in publisher.lower() or
                            self.is_blacklisted(name, 'bnet') or
                            not os.path.isdir(loc)):
                            continue

                        exe_path = self.find_exe_in_directory(loc, self.blacklists['bnet'])
                        if exe_path and name not in seen_games:
                            games.append({
                                "appid": sk,
                                "name": name,
                                "platform": "bnet",
                                "executable": exe_path
                            })
                            seen_games.add(name)
            except FileNotFoundError:
                continue
        
        # Méthode 2: Scanner les dossiers Battle.net sur tous les disques
        for drive in self.drives:
            bnet_paths = [
                os.path.join(drive, "Program Files (x86)", "Battle.net"),
                os.path.join(drive, "Program Files", "Battle.net"),
                os.path.join(drive, "Games", "Battle.net"),
                os.path.join(drive, "Games", "Blizzard"),
                os.path.join(drive, "Blizzard Games")
            ]
            
            for path in bnet_paths:
                if not os.path.exists(path):
                    continue
                
                try:
                    for game_dir in os.listdir(path):
                        if (self.is_blacklisted(game_dir, 'bnet') or 
                            game_dir in seen_games):
                            continue
                        
                        game_path = os.path.join(path, game_dir)
                        if not os.path.isdir(game_path):
                            continue
                        
                        exe_path = self.find_exe_in_directory(game_path, self.blacklists['bnet'])
                        if exe_path:
                            games.append({
                                "appid": game_dir.replace(" ", ""),
                                "name": game_dir,
                                "platform": "bnet",
                                "executable": exe_path
                            })
                            seen_games.add(game_dir)
                except OSError:
                    continue
        
        print(f"[UNIFIED] Battle.net: {len(games)} jeux trouvés")
        return games
    
    # ==================== GOG SCANNER ====================
    def scan_gog(self) -> List[Dict]:
        """Scanner GOG Galaxy sur tous les disques"""
        games = []
        seen_games = set()
        
        print("[UNIFIED] Scan GOG Galaxy...")
        
        # Méthode 1: Scanner via le registre
        uninst_paths = [
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
            (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        ]
        
        for hive, subkey in uninst_paths:
            try:
                base = winreg.OpenKey(hive, subkey, 0, winreg.KEY_READ)
                for i in range(winreg.QueryInfoKey(base)[0]):
                    try:
                        sk = winreg.EnumKey(base, i)
                        k = winreg.OpenKey(base, sk)
                        name, _ = winreg.QueryValueEx(k, "DisplayName")
                        publisher, _ = winreg.QueryValueEx(k, "Publisher")
                        path, _ = winreg.QueryValueEx(k, "InstallLocation")
                        
                        ln = str(name).lower()
                        lp = str(publisher).lower()
                        
                        if (("gog" in ln or "gog" in lp) and path and 
                            os.path.isdir(path) and 
                            not self.is_blacklisted(name, 'gog') and
                            name not in seen_games):
                            
                            exe_path = self.find_exe_in_directory(path, self.blacklists['gog'])
                            if exe_path:
                                games.append({
                                    "appid": name.replace(" ", ""),
                                    "name": name,
                                    "platform": "gog",
                                    "executable": exe_path
                                })
                                seen_games.add(name)
                    except Exception:
                        continue
                winreg.CloseKey(base)
            except (WindowsError, FileNotFoundError):
                continue
        
        # Méthode 2: Scanner les dossiers GOG sur tous les disques
        for drive in self.drives:
            gog_paths = [
                os.path.join(drive, "Program Files (x86)", "GOG Galaxy", "Games"),
                os.path.join(drive, "Program Files", "GOG Galaxy", "Games"),
                os.path.join(drive, "GOG Games"),
                os.path.join(drive, "Games", "GOG")
            ]
            
            for path in gog_paths:
                if not os.path.exists(path):
                    continue
                
                try:
                    for game_dir in os.listdir(path):
                        if (self.is_blacklisted(game_dir, 'gog') or 
                            game_dir in seen_games):
                            continue
                        
                        game_path = os.path.join(path, game_dir)
                        if not os.path.isdir(game_path):
                            continue
                        
                        exe_path = self.find_exe_in_directory(game_path, self.blacklists['gog'])
                        if exe_path:
                            games.append({
                                "appid": game_dir.replace(" ", ""),
                                "name": game_dir,
                                "platform": "gog",
                                "executable": exe_path
                            })
                            seen_games.add(game_dir)
                except OSError:
                    continue
        
        print(f"[UNIFIED] GOG: {len(games)} jeux trouvés")
        return games
    
    # ==================== MICROSOFT STORE SCANNER ====================
    def scan_mstore(self) -> List[Dict]:
        """Scanner Microsoft Store sur tous les disques"""
        games = []
        
        print("[UNIFIED] Scan Microsoft Store...")
        
        for drive in self.drives:
            xbox_path = os.path.join(drive, "XboxGames")
            if not os.path.exists(xbox_path):
                continue
            
            try:
                for folder in os.listdir(xbox_path):
                    game_dir = os.path.join(xbox_path, folder)
                    if not os.path.isdir(game_dir):
                        continue
                    
                    # Chercher un exe de jeu
                    exe_path = None
                    for root, _, files in os.walk(game_dir):
                        for f in files:
                            if f.lower().endswith(".exe") and "gamelaunchhelper" in f.lower():
                                exe_path = os.path.join(root, f)
                                break
                        if exe_path:
                            break
                    
                    if exe_path:
                        games.append({
                            "appid": folder,
                            "name": folder,
                            "platform": "mstore",
                            "executable": exe_path,
                            "launchId": None
                        })
            except OSError:
                continue
        
        print(f"[UNIFIED] Microsoft Store: {len(games)} jeux trouvés")
        return games
    
    # ==================== RIOT GAMES SCANNER ====================
    def scan_riot(self) -> List[Dict]:
        """Scanner Riot Games sur tous les disques"""
        games = []
        seen_games = set()
        
        print("[UNIFIED] Scan Riot Games...")
        
        for drive in self.drives:
            riot_paths = [
                os.path.join(drive, "Program Files", "Riot Games"),
                os.path.join(drive, "Program Files (x86)", "Riot Games"),
                os.path.join(drive, "Riot Games"),
                os.path.join(drive, "Games", "Riot Games")
            ]
            
            for path in riot_paths:
                if not os.path.exists(path):
                    continue
                
                try:
                    for folder in os.listdir(path):
                        if (self.is_blacklisted(folder, 'riot') or 
                            folder in seen_games):
                            continue
                        
                        game_dir = os.path.join(path, folder)
                        if not os.path.isdir(game_dir):
                            continue
                        
                        exe_path = self.find_exe_in_directory(game_dir, self.blacklists['riot'])
                        if exe_path:
                            games.append({
                                "appid": folder,
                                "name": folder,
                                "platform": "riot",
                                "executable": exe_path
                            })
                            seen_games.add(folder)
                except OSError:
                    continue
        
        print(f"[UNIFIED] Riot Games: {len(games)} jeux trouvés")
        return games
    
    # ==================== STAR CITIZEN SCANNER ====================
    def scan_starcitizen(self) -> List[Dict]:
        """Scanner Star Citizen sur tous les disques"""
        games = []
        seen_paths = set()
        target_files = {"StarCitizen_Launcher.exe"}
        
        print("[UNIFIED] Scan Star Citizen...")
        
        for drive in self.drives:
            sc_paths = [
                os.path.join(drive, "Program Files", "Roberts Space Industries", "StarCitizen"),
                os.path.join(drive, "Program Files (x86)", "Roberts Space Industries", "StarCitizen"),
                os.path.join(drive, "Roberts Space Industries", "StarCitizen"),
                os.path.join(drive, "Cloud Imperium Games", "StarCitizen"),
                os.path.join(drive, "Games", "StarCitizen")
            ]
            
            for path in sc_paths:
                if not os.path.exists(path):
                    continue
                
                try:
                    for root, _, files in os.walk(path):
                        for f in files:
                            if f in target_files:
                                exe_path = os.path.join(root, f)
                                npath = os.path.normcase(os.path.normpath(exe_path))
                                
                                if npath not in seen_paths:
                                    games.append({
                                        "appid": "StarCitizen",
                                        "name": "Star Citizen",
                                        "platform": "starcitizen",
                                        "executable": exe_path
                                    })
                                    seen_paths.add(npath)
                except OSError:
                    continue
        
        print(f"[UNIFIED] Star Citizen: {len(games)} jeux trouvés")
        return games
    
    # ==================== ROCKSTAR SCANNER ====================
    def scan_rockstar(self) -> List[Dict]:
        """Scanner Rockstar Games sur tous les disques"""
        games = []
        seen_games = set()
        
        print("[UNIFIED] Scan Rockstar Games...")
        
        # Méthode 1: Scanner via le registre
        bases = [
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
            (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        ]
        
        for hive, sub in bases:
            try:
                key = winreg.OpenKey(hive, sub, 0, winreg.KEY_READ)
                for i in range(winreg.QueryInfoKey(key)[0]):
                    try:
                        sk = winreg.EnumKey(key, i)
                        skey = winreg.OpenKey(key, sk)
                        name, _ = winreg.QueryValueEx(skey, "DisplayName")
                        publisher, _ = winreg.QueryValueEx(skey, "Publisher")
                        loc, _ = winreg.QueryValueEx(skey, "InstallLocation")
                        
                        name_lower = str(name).lower()
                        pub_lower = str(publisher).lower()
                        
                        if ("rockstar" in name_lower or "rockstar" in pub_lower):
                            # Utiliser les filtres de validation génériques
                            if (not self.is_blacklisted(name, 'rockstar') and 
                                self.is_valid_game(name) and 
                                loc and os.path.isdir(loc) and name not in seen_games):
                                exe_path = self.find_exe_in_directory(loc, self.blacklists['rockstar'])
                                if exe_path and self.is_valid_game(name, exe_path):
                                    games.append({
                                        "appid": str(name).replace(" ", ""),
                                        "name": str(name),
                                        "platform": "rockstar",
                                        "executable": exe_path
                                    })
                                    seen_games.add(name)
                    except OSError:
                        continue
                winreg.CloseKey(key)
            except FileNotFoundError:
                continue
        
        # Méthode 2: Scanner les dossiers Rockstar sur tous les disques
        for drive in self.drives:
            rockstar_paths = [
                os.path.join(drive, "Program Files", "Rockstar Games"),
                os.path.join(drive, "Program Files (x86)", "Rockstar Games"),
                os.path.join(drive, "Games", "Rockstar Games"),
                os.path.join(drive, "Rockstar Games")
            ]
            
            for path in rockstar_paths:
                if not os.path.exists(path):
                    continue
                
                try:
                    for game_dir in os.listdir(path):
                        if game_dir in seen_games:
                            continue
                        
                        game_path = os.path.join(path, game_dir)
                        if not os.path.isdir(game_path):
                            continue
                        
                        # Filtrer les dossiers non-jeux (launcher, social club, etc.)
                        if (self.is_blacklisted(game_dir, 'rockstar') or 
                            not self.is_valid_game(game_dir)):
                            continue
                        
                        exe_path = self.find_exe_in_directory(game_path, self.blacklists['rockstar'])
                        if exe_path and self.is_valid_game(game_dir, exe_path):
                            games.append({
                                "appid": game_dir.replace(" ", ""),
                                "name": game_dir,
                                "platform": "rockstar",
                                "executable": exe_path
                            })
                            seen_games.add(game_dir)
                except OSError:
                    continue
        
        print(f"[UNIFIED] Rockstar: {len(games)} jeux trouvés")
        return games
    
    # ==================== SCANNER PRINCIPAL ====================
    def scan_all_platforms(self, output_file: str = None) -> List[Dict]:
        """Scanner principal pour toutes les plateformes"""
        start_time = time.time()
        
        print(f"[UNIFIED] GameHUBZ Unified Scanner v{SCANNER_VERSION}")
        print("[UNIFIED] Démarrage du scan unifié...")
        
        # Initialisation
        self.drives = self.get_all_drives()
        drive_info = self.get_drive_info()
        accessible_drives = [d for d, info in drive_info.items() if info['accessible']]
        
        print(f"[UNIFIED] {len(accessible_drives)} disques détectés: {', '.join(accessible_drives)}")
        self.send_progress("Initialisation", 5, 0)
        
        # Définir les groupes de plateformes par priorité
        priority_groups = {
            1: ['steam', 'epic', 'riot', 'starcitizen'],  # Rapides
            2: ['ea', 'ubi', 'bnet', 'rockstar'],         # Moyens
            3: ['gog', 'mstore']                          # Lents
        }
        
        # Scanners par plateforme
        scanners = {
            'steam': self.scan_steam,
            'epic': self.scan_epic,
            'ea': self.scan_ea,
            'ubi': self.scan_ubisoft,
            'bnet': self.scan_battlenet,
            'gog': self.scan_gog,
            'mstore': self.scan_mstore,
            'riot': self.scan_riot,
            'starcitizen': self.scan_starcitizen,
            'rockstar': self.scan_rockstar
        }
        
        total_platforms = len(scanners)
        completed_platforms = 0
        
        # Scanner par groupes de priorité
        for priority, platforms in priority_groups.items():
            group_name = ["rapides", "moyens", "lents"][priority-1]
            platforms_in_group = [p for p in platforms if p in scanners]
            
            if not platforms_in_group:
                continue
            
            print(f"[UNIFIED] Scan groupe {group_name}: {len(platforms_in_group)} plateformes")
            self.send_progress(f"Scan {group_name}", 
                             10 + int((completed_platforms / total_platforms) * 80), 
                             len(self.all_games))
            
            # Parallélisation pour les groupes rapides et moyens
            max_workers = 4 if priority == 1 else 2 if priority == 2 else 1
            
            with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
                future_to_platform = {
                    executor.submit(scanners[platform]): platform 
                    for platform in platforms_in_group
                }
                
                for future in concurrent.futures.as_completed(future_to_platform):
                    platform = future_to_platform[future]
                    try:
                        platform_games = future.result()
                        if platform_games:
                            self.all_games.extend(platform_games)
                            self.send_progress(
                                PLATFORMS[platform]['name'], 
                                10 + int(((completed_platforms + 1) / total_platforms) * 80),
                                len(self.all_games),
                                platform_games
                            )
                        completed_platforms += 1
                    except Exception as e:
                        print(f"[UNIFIED] Erreur lors du scan {platform}: {e}")
                        completed_platforms += 1
        
        # Finalisation - déduplication
        print(f"[UNIFIED] Avant déduplication: {len(self.all_games)} jeux")
        self.all_games = self.deduplicate_games(self.all_games)
        print(f"[UNIFIED] Après déduplication: {len(self.all_games)} jeux")
        
        scan_time = time.time() - start_time
        self.scan_stats = {
            'total_games': len(self.all_games),
            'scan_time': scan_time,
            'platforms_found': len(set(game['platform'] for game in self.all_games))
        }
        
        # Sauvegarde
        if output_file is None:
            if getattr(sys, 'frozen', False):
                exe_dir = os.path.dirname(sys.executable)
            else:
                exe_dir = os.getcwd()
            output_file = os.path.join(exe_dir, '..', 'games.json')
        
        try:
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(self.all_games, f, indent=2, ensure_ascii=False)
            print(f"[UNIFIED] {len(self.all_games)} jeux sauvegardés dans {output_file}")
        except Exception as e:
            print(f"[UNIFIED] Erreur lors de la sauvegarde: {e}")
        
        self.send_progress("Terminé", 100, len(self.all_games))
        
        print(f"[UNIFIED] Scan terminé en {scan_time:.2f}s")
        print(f"[UNIFIED] {len(self.all_games)} jeux trouvés sur {self.scan_stats['platforms_found']} plateformes")
        
        # Afficher le résumé par plateforme
        platform_counts = {}
        for game in self.all_games:
            platform = game.get('platform', 'unknown')
            platform_counts[platform] = platform_counts.get(platform, 0) + 1
        
        summary_parts = []
        for platform, count in sorted(platform_counts.items()):
            platform_name = PLATFORMS.get(platform, {}).get('name', platform.title())
            summary_parts.append(f"{count} {platform_name}")
        
        print(f"[UNIFIED] Détail: {', '.join(summary_parts)}")
        
        return self.all_games

# ==================== SYSTÈME DE MISE À JOUR ====================
def check_for_updates() -> Dict:
    """Vérifie s'il y a des mises à jour disponibles"""
    try:
        # Vérifier sur GitHub (exemple)
        api_url = "https://api.github.com/repos/gamehubz/gamehubz/releases/latest"
        response = requests.get(api_url, timeout=10)
        
        if response.status_code == 200:
            latest = response.json()
            latest_version = latest.get('tag_name', '').lstrip('v')
            
            if latest_version != SCANNER_VERSION:
                return {
                    'update_available': True,
                    'current_version': SCANNER_VERSION,
                    'latest_version': latest_version,
                    'download_url': latest.get('zipball_url'),
                    'release_notes': latest.get('body', '')
                }
    except Exception as e:
        print(f"[UPDATE] Erreur lors de la vérification des mises à jour: {e}")
    
    return {'update_available': False, 'current_version': SCANNER_VERSION}

def apply_update(download_url: str) -> bool:
    """Applique une mise à jour"""
    try:
        print("[UPDATE] Téléchargement de la mise à jour...")
        # Logique de téléchargement et application
        # À implémenter selon les besoins
        return True
    except Exception as e:
        print(f"[UPDATE] Erreur lors de l'application de la mise à jour: {e}")
        return False

# ==================== POINT D'ENTRÉE PRINCIPAL ====================
def main():
    """Point d'entrée principal"""
    
    def send_progress(platform, percentage, games_found=0, platform_games=None):
        """Callback de progression pour l'interface"""
        progress_data = {
            "type": "progress",
            "platform": platform,
            "percentage": percentage,
            "games_found": games_found,
            "games": platform_games or []
        }
        progress_line = "PROGRESS:" + json.dumps(progress_data, ensure_ascii=False)
        print(progress_line)
        sys.stdout.flush()
    
    # Vérifier les mises à jour
    if "--check-updates" in sys.argv:
        update_info = check_for_updates()
        if update_info['update_available']:
            print(f"[UPDATE] Mise à jour disponible: {update_info['latest_version']}")
            print(f"[UPDATE] Version actuelle: {update_info['current_version']}")
        else:
            print(f"[UPDATE] Aucune mise à jour disponible (version {update_info['current_version']})")
        return
    
    # Scanner principal
    scanner = UnifiedGameScanner(send_progress)
    
    try:
        games = scanner.scan_all_platforms()
        
        # Afficher les statistiques finales
        stats = scanner.scan_stats
        print(f"\n=== Statistiques finales ===")
        print(f"Jeux trouvés: {stats['total_games']}")
        print(f"Plateformes actives: {stats['platforms_found']}")
        print(f"Temps de scan: {stats['scan_time']:.2f}s")
        print(f"Disques scannés: {len(scanner.drives)}")
        
    except KeyboardInterrupt:
        print("\n[UNIFIED] Scan interrompu par l'utilisateur")
    except Exception as e:
        print(f"\n[UNIFIED] Erreur fatale: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    main()