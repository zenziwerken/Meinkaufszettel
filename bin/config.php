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
    ''
];

$speiseplanName = 'Speiseplan';
$germanDays = ["MO", "DI", "MI", "DO", "FR", "SA", "SO"];
$colors = [ "#ffc1ba", "#ffe1c7", "#fff2bf", "#c4f5cb", "#c2e6fd", "#f3d3ff", "#ffd6ea"];