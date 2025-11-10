<?php
// --- Konfiguration (anpassen) ---
$saveDir = __DIR__ . '/../data'; 
$passwordFile = $saveDir . '/.password';
$hashedPassword = trim(@file_get_contents($passwordFile) ?: '');

$tokenDir  = $saveDir . '/tokens';

$filenameMatch = '/^[a-zA-ZäöüÄÖÜß0-9_-~]+$/'; 
$maxItemsPerList = 200;
$maxItemLength = 200; 
$allowedOrigins = [
    'https://www.objective-view.de'
];

$speiseplanName = 'Speiseplan';
$germanDays = ["MO", "DI", "MI", "DO", "FR", "SA", "SO"];
$colors = [ "#ffc1ba", "#ffe1c7", "#fff2bf", "#c4f5cb", "#c2e6fd", "#f3d3ff", "#ffd6ea"];
$colorBorder = [ "#e48176", "#f5b788", "#fce588", "#8de4a1", "#8cc9f0", "#e7a3f0", "#f4a9c9"];