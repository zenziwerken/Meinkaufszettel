<?php
// Erlaubtes Muster für Listennamen (Dateinamen innerhalb eines Benutzer-Verzeichnisses)
$filenameMatch = '/^[a-zA-ZäöüÄÖÜß0-9_-~]{2,}+$/'; 

// Erlaubtes Muster für Benutzernamen (Verzeichnisnamen unter data)
$usernameMatch = '/^[a-zA-Z0-9_-]{3,}+$/';

// Maximale Anzahl an Listen
$maxList = 200;

// Maximale Anzahl Einträge pro Liste
$maxItemsPerList = 200;

// Maximale Länge eines Listeneintrags
$maxItemLength = 200; 

// Synchronisations-Intervall für automatischen Abgleich in Sekunden
$syncInterval = 30; 

// Zurück zur Listenansicht nach x Minuten Inaktivität in Minuten
$inactivityTimeout = 10; 

// Erlaube nur Zugriffe von bestimmten Domains (CORS)
$allowedOrigins = [
    ''
];

$adminUsers = [
    ''
];

// Spezielle Einstellungen für Sonderfunktion des "Speiseplans"
$speiseplanName = 'Speiseplan';
$dayNames    = ["MO", "DI", "MI", "DO", "FR", "SA", "SO"];
$colors      = [ "#ffc1ba", "#ffe1c7", "#fff2bf", "#c4f5cb", "#c2e6fd", "#f3d3ff", "#ffd6ea"];
$colorBorder = [ "#e48176", "#f5b788", "#fce588", "#8de4a1", "#8cc9f0", "#e7a3f0", "#f4a9c9"];

// --- Speicherorte (Basis) ---
$dataDirBase    = __DIR__ . '/../data'; 

// Ein Verzeichnis für Einladungstokens (global)
$invitesDir     = $dataDirBase . '/invites';

// Ein Verzeichnis für Benutzerdaten (Passwörter, Einstellungen, ...)
$usersDir       = $dataDirBase . '/user';

// Ein Verzeichnis für geteilte Listen (global)
$sharesDir      = $dataDirBase . '/shares'; 

// Verzeichnis für Passwort-Reset-Tokens
$resetsDir      = $dataDirBase . '/resets';

// Verzeichnis für Ratelimiting-Daten
$rateLimitDir   = $dataDirBase . '/ratelimit';

// Temporäres Verzeichnis für Zwischenspeicherungen
$tmpDir         = $dataDirBase . '/tmp';

// Ablaufzeit eines Reset-Tokens in Sekunden (Standard: 1 Stunde)
$resetTokenExpiry = 3600;

// --- Cleanup / Garbage-Collection Einstellungen (Tage) ---
// Alte Benutzer-Token in Tagen (Standard: 60 Tage)
$userTokenCleanupDays = 60;

// Ungültige Reset-Dateien werden nach dieser Anzahl Tagen gelöscht (Standard: 30 Tage)
$invalidResetKeepDays = 30;

// Maximalalter für Challenge-Dateien in Tagen (Standard: 365 Tage ~ 1 Jahr)
$challengeMaxAgeDays = 365;

// Einfaches Ratelimiting für Passwort-Reset-Anfragen
// Max. Anfragen
$maxRequests = 5; 

// Zeitfenster in Sekunden   
$timeWindow = 600;

// Alte Ratelimit-Dateien in Tagen (Standard: 7 Tage)
$rateLimitCleanupDays = 7; 