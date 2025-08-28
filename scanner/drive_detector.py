#!/usr/bin/env python3
"""
Module centralisé pour la détection de disques durs et chemins de jeux sur Windows.
Optimise la recherche multi-disques pour tous les scanners de GameHUBZ.
"""
import os
import string
import ctypes
from typing import List, Dict, Tuple
import time

def get_all_drives() -> List[str]:
    """
    Récupère tous les lecteurs disponibles sur le système Windows.
    
    Returns:
        Liste des lettres de lecteur (ex: ['C:\\', 'D:\\', 'E:\\'])
    """
    drives = []
    try:
        bitmask = ctypes.cdll.kernel32.GetLogicalDrives()
        for letter in string.ascii_uppercase:
            if bitmask & 1:
                drives.append(f"{letter}:\\")
            bitmask >>= 1
    except Exception as e:
        print(f"[DRIVES] Erreur lors de la détection des lecteurs: {e}")
        # Fallback sur les lecteurs courants si l'API échoue
        drives = ['C:\\', 'D:\\', 'E:\\', 'F:\\']
    
    # Filtrer les lecteurs réellement accessibles
    accessible_drives = []
    for drive in drives:
        try:
            if os.path.exists(drive):
                accessible_drives.append(drive)
        except:
            continue
    
    return accessible_drives

def get_drives_by_priority() -> Tuple[List[str], List[str]]:
    """
    Sépare les disques en priorité haute (C:) et autres pour optimiser les scans.
    
    Returns:
        Tuple (priority_drives, other_drives)
    """
    all_drives = get_all_drives()
    priority_drives = ['C:\\']
    other_drives = [d for d in all_drives if d not in priority_drives]
    
    return priority_drives, other_drives

def get_common_game_paths(drives: List[str] = None) -> Dict[str, List[str]]:
    """
    Génère les chemins courants où les jeux peuvent être installés sur tous les disques.
    
    Args:
        drives: Liste des disques à analyser (None = tous)
    
    Returns:
        Dictionnaire avec les chemins par catégorie
    """
    if drives is None:
        drives = get_all_drives()
    
    paths = {
        'steam': [],
        'epic': [],
        'ea': [],
        'ubisoft': [],
        'battlenet': [],
        'gog': [],
        'mstore': [],
        'riot': [],
        'rockstar': [],
        'generic': []
    }
    
    for drive in drives:
        # Steam - chercher dans Program Files ET racine des disques
        paths['steam'].extend([
            os.path.join(drive, "Program Files (x86)", "Steam"),
            os.path.join(drive, "Program Files", "Steam"),
            os.path.join(drive, "Steam"),  # Installation personnalisée
            os.path.join(drive, "SteamLibrary"),  # Bibliothèque secondaire courante
            os.path.join(drive, "Games", "Steam")  # Organisation personnelle
        ])
        
        # Epic Games Store
        paths['epic'].extend([
            os.path.join(drive, "Program Files", "Epic Games"),
            os.path.join(drive, "Program Files (x86)", "Epic Games"),
            os.path.join(drive, "Epic Games"),
            os.path.join(drive, "Games", "Epic Games")
        ])
        
        # EA/Origin
        paths['ea'].extend([
            os.path.join(drive, "Program Files (x86)", "Origin Games"),
            os.path.join(drive, "Program Files", "EA Games"),
            os.path.join(drive, "Program Files (x86)", "EA Games"),
            os.path.join(drive, "Origin Games"),
            os.path.join(drive, "EA Games"),
            os.path.join(drive, "Games", "Origin"),
            os.path.join(drive, "Games", "EA")
        ])
        
        # Ubisoft Connect
        paths['ubisoft'].extend([
            os.path.join(drive, "Program Files (x86)", "Ubisoft", "Ubisoft Game Launcher", "games"),
            os.path.join(drive, "Program Files", "Ubisoft", "Ubisoft Game Launcher", "games"),
            os.path.join(drive, "Ubisoft Games"),
            os.path.join(drive, "Games", "Ubisoft")
        ])
        
        # Battle.net (Blizzard)
        paths['battlenet'].extend([
            os.path.join(drive, "Program Files (x86)", "Battle.net"),
            os.path.join(drive, "Program Files", "Battle.net"),
            os.path.join(drive, "Games", "Battle.net")
        ])
        
        # GOG Galaxy
        paths['gog'].extend([
            os.path.join(drive, "Program Files (x86)", "GOG Galaxy", "Games"),
            os.path.join(drive, "Program Files", "GOG Galaxy", "Games"),
            os.path.join(drive, "GOG Games"),
            os.path.join(drive, "Games", "GOG")
        ])
        
        # Microsoft Store (XboxGames)
        paths['mstore'].extend([
            os.path.join(drive, "XboxGames")
        ])
        
        # Riot Games
        paths['riot'].extend([
            os.path.join(drive, "Program Files", "Riot Games"),
            os.path.join(drive, "Program Files (x86)", "Riot Games"),
            os.path.join(drive, "Riot Games"),
            os.path.join(drive, "Games", "Riot Games")
        ])
        
        # Rockstar Games
        paths['rockstar'].extend([
            os.path.join(drive, "Program Files", "Rockstar Games"),
            os.path.join(drive, "Program Files (x86)", "Rockstar Games"),
            os.path.join(drive, "Games", "Rockstar Games")
        ])
        
        # Chemins génériques communs
        paths['generic'].extend([
            os.path.join(drive, "Games"),
            os.path.join(drive, "Program Files", "Games"),
            os.path.join(drive, "Program Files (x86)", "Games"),
            os.path.join(drive, "My Games")
        ])
    
    return paths

def find_existing_paths(platform: str, drives: List[str] = None) -> List[str]:
    """
    Trouve tous les chemins existants pour une plateforme donnée sur tous les disques.
    
    Args:
        platform: Nom de la plateforme (steam, epic, etc.)
        drives: Liste des disques à analyser (None = tous)
    
    Returns:
        Liste des chemins existants
    """
    all_paths = get_common_game_paths(drives)
    platform_paths = all_paths.get(platform, [])
    
    existing_paths = []
    for path in platform_paths:
        try:
            if os.path.exists(path):
                existing_paths.append(path)
        except Exception:
            continue
    
    return existing_paths

def scan_drives_for_pattern(pattern: str, drives: List[str] = None, max_depth: int = 3) -> List[str]:
    """
    Recherche un motif (dossier ou fichier) sur tous les disques spécifiés.
    
    Args:
        pattern: Motif à rechercher (ex: "Steam", "*.exe")
        drives: Liste des disques à analyser (None = tous)
        max_depth: Profondeur maximale de recherche depuis la racine
    
    Returns:
        Liste des chemins correspondant au motif
    """
    if drives is None:
        drives = get_all_drives()
    
    found_paths = []
    
    for drive in drives:
        try:
            # Recherche récursive limitée en profondeur
            for root, dirs, files in os.walk(drive):
                # Calculer la profondeur actuelle
                depth = root[len(drive):].count(os.sep)
                if depth >= max_depth:
                    dirs[:] = []  # Empêcher la descente plus profonde
                    continue
                
                # Vérifier les dossiers
                for dir_name in dirs:
                    if pattern.lower() in dir_name.lower():
                        found_paths.append(os.path.join(root, dir_name))
                
                # Vérifier les fichiers si nécessaire
                if "*" in pattern:
                    import fnmatch
                    for file_name in files:
                        if fnmatch.fnmatch(file_name.lower(), pattern.lower()):
                            found_paths.append(os.path.join(root, file_name))
                            
        except (OSError, PermissionError):
            continue
    
    return found_paths

def get_drive_info() -> Dict[str, Dict]:
    """
    Récupère des informations sur tous les disques disponibles.
    
    Returns:
        Dictionnaire avec info par disque (espace libre, type, etc.)
    """
    drives = get_all_drives()
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
            
            # Déterminer le type de lecteur
            drive_type = ctypes.windll.kernel32.GetDriveTypeW(drive)
            type_names = {
                0: "Unknown",
                1: "Invalid",
                2: "Removable",
                3: "Fixed",
                4: "Network",
                5: "CD-ROM",
                6: "RAM"
            }
            
            info[drive] = {
                'free_space_gb': free_space.value / (1024**3),
                'total_space_gb': total_space.value / (1024**3),
                'type': type_names.get(drive_type, "Unknown"),
                'accessible': True
            }
            
        except Exception as e:
            info[drive] = {
                'free_space_gb': 0,
                'total_space_gb': 0,
                'type': "Error",
                'accessible': False,
                'error': str(e)
            }
    
    return info

def optimize_scan_order(drives: List[str] = None) -> List[str]:
    """
    Optimise l'ordre de scan des disques (SSD avant HDD, plus d'espace libre en premier).
    
    Args:
        drives: Liste des disques à optimiser (None = tous)
    
    Returns:
        Liste des disques dans l'ordre optimal
    """
    if drives is None:
        drives = get_all_drives()
    
    drive_info = get_drive_info()
    
    # Séparer et trier les disques
    priority_drives = []  # C: et SSD probables
    standard_drives = []  # Autres disques fixes
    other_drives = []     # Réseau, amovible, etc.
    
    for drive in drives:
        info = drive_info.get(drive, {})
        
        if not info.get('accessible', False):
            continue
            
        if drive == 'C:\\':
            priority_drives.insert(0, drive)  # C: en premier
        elif info.get('type') == 'Fixed':
            standard_drives.append(drive)
        else:
            other_drives.append(drive)
    
    # Trier les disques standards par espace libre (plus d'espace = plus de chance d'avoir des jeux)
    standard_drives.sort(key=lambda d: drive_info.get(d, {}).get('free_space_gb', 0), reverse=True)
    
    return priority_drives + standard_drives + other_drives

def print_drive_summary():
    """Affiche un résumé des disques détectés"""
    drives = get_all_drives()
    info = get_drive_info()
    
    print(f"[DRIVES] {len(drives)} disques détectés:")
    
    for drive in drives:
        drive_info = info.get(drive, {})
        if drive_info.get('accessible'):
            free_gb = drive_info.get('free_space_gb', 0)
            total_gb = drive_info.get('total_space_gb', 0)
            drive_type = drive_info.get('type', 'Unknown')
            print(f"[DRIVES] {drive} - {drive_type} - {free_gb:.1f}/{total_gb:.1f} GB libre")
        else:
            print(f"[DRIVES] {drive} - Non accessible")

if __name__ == "__main__":
    # Test des fonctions
    print("=== Test du détecteur de disques ===")
    
    print_drive_summary()
    
    # Test d'optimisation de l'ordre
    optimized = optimize_scan_order()
    print(f"\nOrdre de scan optimisé: {optimized}")
    
    # Test de recherche Steam
    steam_paths = find_existing_paths('steam')
    print(f"\nChemins Steam trouvés: {len(steam_paths)}")
    for path in steam_paths[:5]:  # Afficher les 5 premiers
        print(f"  - {path}")
    
    # Test de recherche de motif
    print("\nRecherche de dossiers 'Games'...")
    games_folders = scan_drives_for_pattern("Games", max_depth=2)
    print(f"Trouvé {len(games_folders)} dossiers 'Games'")