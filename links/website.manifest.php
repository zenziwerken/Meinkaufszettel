<?php
// Dynamisches Web App Manifest: wählt Farben basierend auf Cookie 'mode'
header('Content-Type: application/manifest+json; charset=utf-8');
// Verhindere aggressive Zwischenablage/Caching, da das Manifest vom Cookie abhängt
header('Cache-Control: private, max-age=0, no-cache, no-store, must-revalidate');

$manifest = [
    'name' => 'Meinkaufszettel',
    'short_name' => 'Einkaufszettl',
    'start_url' => ($installPath = rtrim(dirname(dirname($_SERVER['SCRIPT_NAME'])), '/\\') . '/') . 'index.php',
    'scope' => $installPath,
    'icons' => [
        [ 'src' => 'icon-192.png', 'type' => 'image/png', 'sizes' => '192x192' ],
        [ 'src' => 'icon-512.png', 'type' => 'image/png', 'sizes' => '512x512' ],
        [ 'src' => 'icon.svg', 'sizes' => 'any', 'type' => 'image/svg+xml' ],
    ],
    
   "theme_color" =>"#000",
   "background_color"=>"#000",
   "display"=>"standalone"
];

echo json_encode($manifest, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);

/*

    'theme_color' => 'transparent',
    'background_color' => '#000000',
    'display' => 'standalone',
    'orientation' => 'portrait',
    'display_override' => [ 'standalone', 'window-controls-overlay' ],
*/