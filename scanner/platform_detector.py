#!/usr/bin/env python3
"""
Module de détection rapide des plateformes installées.
Permet d'optimiser le scan en ne scannant que les plateformes réellement présentes.
"""
import os
import json
import winreg
import string
import ctypes
from drive_detector import get_all_drives, find_existing_paths, optimize_scan_order

def check_steam_installed():
    """Vérifie si Steam est installé sur tous les disques"""
    steam_paths = find_existing_paths('steam')
    
    for path in steam_paths:
        steamapps = os.path.join(path, "steamapps")
        if os.path.exists(steamapps):
            # Vérifier qu'il y a au moins un fichier .acf
            try:
                files = os.listdir(steamapps)
                if any(f.startswith("appmanifest") and f.endswith(".acf") for f in files):
                    return True, steamapps
            except OSError:
                continue
    return False, None

def check_epic_installed():
    """Vérifie si Epic Games Store est installé sur tous les disques"""
    # Vérifier d'abord les manifestes par défaut
    manifests_path = r"C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests"
    if os.path.exists(manifests_path):
        try:
            files = os.listdir(manifests_path)
            if any(f.endswith(".item") for f in files):
                return True, manifests_path
        except OSError:
            pass
    
    # Chercher les installations Epic sur tous les disques
    epic_paths = find_existing_paths('epic')
    for path in epic_paths:
        if os.path.exists(path) and os.listdir(path):
            return True, path
    
    return False, None

def check_ea_installed():
    """Vérifie si EA/Origin est installé sur tous les disques"""
    ea_paths = find_existing_paths('ea')
    
    found_paths = []
    for path in ea_paths:
        try:
            if os.path.exists(path) and os.listdir(path):
                found_paths.append(path)
        except OSError:
            continue
    
    return len(found_paths) > 0, found_paths

def check_ubisoft_installed():
    """Vérifie si Ubisoft Connect est installé sur tous les disques"""
    try:
        # Vérifier dans la base de registre
        key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, 
                            r"SOFTWARE\WOW6432Node\Ubisoft\Launcher", 
                            0, winreg.KEY_READ)
        install_dir = winreg.QueryValueEx(key, "InstallDir")[0]
        winreg.CloseKey(key)
        
        if os.path.exists(install_dir):
            return True, install_dir
    except (WindowsError, FileNotFoundError):
        pass
    
    # Chercher sur tous les disques
    ubisoft_paths = find_existing_paths('ubisoft')
    for path in ubisoft_paths:
        try:
            if os.path.exists(path) and os.listdir(path):
                return True, path
        except OSError:
            continue
    
    return False, None

def check_battlenet_installed():
    """Vérifie si Battle.net est installé"""
    try:
        # Vérifier dans la base de registre
        key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, 
                            r"SOFTWARE\WOW6432Node\Blizzard Entertainment\Battle.net\Capabilities", 
                            0, winreg.KEY_READ)
        winreg.CloseKey(key)
        return True, None
    except (WindowsError, FileNotFoundError):
        pass
    
    # Vérifier le chemin par défaut
    default_path = os.path.expandvars(r"%ProgramFiles(x86)%\Battle.net")
    if os.path.exists(default_path):
        return True, default_path
    
    return False, None

def check_gog_installed():
    """Vérifie si GOG Galaxy est installé"""
    try:
        # Vérifier dans la base de registre pour les jeux GOG
        uninst_paths = [
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall")
        ]
        
        for hive, subkey in uninst_paths:
            try:
                base = winreg.OpenKey(hive, subkey, 0, winreg.KEY_READ)
                for i in range(winreg.QueryInfoKey(base)[0]):
                    try:
                        key_name = winreg.EnumKey(base, i)
                        if key_name.startswith("GOG ") or "_is1" in key_name:
                            winreg.CloseKey(base)
                            return True, None
                    except OSError:
                        continue
                winreg.CloseKey(base)
            except (WindowsError, FileNotFoundError):
                continue
    except Exception:
        pass
    
    return False, None

def check_mstore_installed():
    """Vérifie si Microsoft Store Games est installé sur tous les disques"""
    mstore_paths = find_existing_paths('mstore')
    
    for path in mstore_paths:
        try:
            if os.path.exists(path) and os.listdir(path):
                return True, path
        except OSError:
            continue
    
    return False, None

def check_riot_installed():
    """Vérifie si Riot Games est installé sur tous les disques"""
    riot_paths = find_existing_paths('riot')
    
    for path in riot_paths:
        if os.path.exists(path):
            # Chercher Valorant, League of Legends, etc.
            try:
                subdirs = [d for d in os.listdir(path) if os.path.isdir(os.path.join(path, d))]
                if subdirs:
                    return True, path
            except OSError:
                continue
    
    return False, None

def check_starcitizen_installed():
    """Vérifie si Star Citizen est installé"""
    sc_paths = [
        r"C:\Program Files\Roberts Space Industries",
        os.path.expandvars(r"%ProgramFiles%\Roberts Space Industries")
    ]
    
    for path in sc_paths:
        if os.path.exists(path):
            sc_path = os.path.join(path, "StarCitizen")
            if os.path.exists(sc_path):
                return True, sc_path
    
    return False, None

def check_rockstar_installed():
    """Vérifie si Rockstar Games est installé sur tous les disques"""
    try:
        # Vérifier dans la base de registre
        key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, 
                            r"SOFTWARE\WOW6432Node\Rockstar Games\Launcher", 
                            0, winreg.KEY_READ)
        winreg.CloseKey(key)
        return True, None
    except (WindowsError, FileNotFoundError):
        pass
    
    # Chercher sur tous les disques
    rockstar_paths = find_existing_paths('rockstar')
    for path in rockstar_paths:
        try:
            if os.path.exists(path) and os.listdir(path):
                return True, path
        except OSError:
            continue
    
    return False, None

def detect_installed_platforms():
    """
    Détecte toutes les plateformes installées.
    Retourne un dictionnaire avec les plateformes trouvées et leurs chemins.
    """
    platforms = {}
    
    detectors = {
        'steam': check_steam_installed,
        'epic': check_epic_installed,
        'ea': check_ea_installed,
        'ubi': check_ubisoft_installed,
        'bnet': check_battlenet_installed,
        'gog': check_gog_installed,
        'mstore': check_mstore_installed,
        'riot': check_riot_installed,
        'starcitizen': check_starcitizen_installed,
        'rockstar': check_rockstar_installed
    }
    
    print("[DETECTOR] Détection des plateformes installées...")
    
    for platform, detector in detectors.items():
        try:
            is_installed, path = detector()
            if is_installed:
                platforms[platform] = {
                    'installed': True,
                    'path': path,
                    'name': get_platform_display_name(platform)
                }
                print(f"[DETECTOR] ✓ {platforms[platform]['name']} détecté")
            else:
                print(f"[DETECTOR] ✗ {get_platform_display_name(platform)} non trouvé")
        except Exception as e:
            print(f"[DETECTOR] Erreur lors de la détection de {platform}: {e}")
            continue
    
    print(f"[DETECTOR] {len(platforms)} plateformes détectées sur {len(detectors)}")
    return platforms

def get_platform_display_name(platform):
    """Retourne le nom d'affichage d'une plateforme"""
    names = {
        'steam': 'Steam',
        'epic': 'Epic Games Store',
        'ea': 'Electronic Arts',
        'ubi': 'Ubisoft Connect',
        'bnet': 'Battle.net',
        'gog': 'GOG Galaxy',
        'mstore': 'Microsoft Store',
        'riot': 'Riot Games',
        'starcitizen': 'Cloud Imperium Games',
        'rockstar': 'Rockstar Games'
    }
    return names.get(platform, platform.title())

def save_platform_cache(platforms, cache_file="platform_cache.json"):
    """Sauvegarde le cache de détection des plateformes"""
    try:
        cache_path = os.path.join(os.path.dirname(__file__), cache_file)
        with open(cache_path, 'w', encoding='utf-8') as f:
            json.dump(platforms, f, indent=2, ensure_ascii=False)
        print(f"[DETECTOR] Cache sauvegardé: {len(platforms)} plateformes")
    except Exception as e:
        print(f"[DETECTOR] Erreur lors de la sauvegarde du cache: {e}")

def load_platform_cache(cache_file="platform_cache.json"):
    """Charge le cache de détection des plateformes"""
    try:
        cache_path = os.path.join(os.path.dirname(__file__), cache_file)
        if os.path.exists(cache_path):
            with open(cache_path, 'r', encoding='utf-8') as f:
                platforms = json.load(f)
            print(f"[DETECTOR] Cache chargé: {len(platforms)} plateformes")
            return platforms
    except Exception as e:
        print(f"[DETECTOR] Erreur lors du chargement du cache: {e}")
    return {}

if __name__ == "__main__":
    # Test de détection
    platforms = detect_installed_platforms()
    save_platform_cache(platforms)
    
    print("\n=== Résultats de détection ===")
    for platform, info in platforms.items():
        print(f"{info['name']}: {info['path'] or 'Détecté'}")