<?php
// Erlaubtes Muster für Listennamen (Verzeichnis- und Dateinamen)
$filenameMatch = '/^[a-zA-ZäöüÄÖÜß0-9_-~]+$/'; 

// Maximale Anzahl Einträge pro Liste
$maxItemsPerList = 200;

// Maximale Länge eines Listeneintrags
$maxItemLength = 200; 

// Synchronisations-Intervall für automatischen Abgleich
$syncInterval = 30 /* Sekunden */ * 1000; 

// Zurück zur Listenansicht nach x Minuten Inaktivität
$inactivityTimeoutMs = 10 /* Minuten */ * 60 * 1000; 

// Erlaube nur Zugriffe von bestimmten Domains (CORS)
$allowedOrigins = [
    'https://www.objective-view.de'
];

// Spezielle Einstellungen für Sonderfunktion des "Speiseplans"
$speiseplanName = 'Speiseplan';
$dayNames    = ["MO", "DI", "MI", "DO", "FR", "SA", "SO"];
$colors      = [ "#ffc1ba", "#ffe1c7", "#fff2bf", "#c4f5cb", "#c2e6fd", "#f3d3ff", "#ffd6ea"];
$colorBorder = [ "#e48176", "#f5b788", "#fce588", "#8de4a1", "#8cc9f0", "#e7a3f0", "#f4a9c9"];

// --- Speicherorte ---
$saveDir        = __DIR__ . '/../data'; 
$passwordFile   = $saveDir . '/.password';
$hashedPassword = trim(@file_get_contents($passwordFile) ?: '');
$tokenDir       = $saveDir . '/tokens';