<?php
// Dynamisches Web App Manifest: wählt Farben basierend auf Cookie 'mode'
header('Content-Type: application/manifest+json; charset=utf-8');
// Verhindere aggressive Zwischenablage/Caching, da das Manifest vom Cookie abhängt
header('Cache-Control: private, max-age=0, no-cache, no-store, must-revalidate');

$mode = isset($_COOKIE['mode']) ? $_COOKIE['mode'] : '';
if ($mode === 'dark') {
    $theme = '#111111';
    $bg = '#000000';
} elseif ($mode === 'light') {
    $theme = '#ffffff';
    $bg = '#ffffff';
} else {
    // Fallback: helles Theme; Client kann bei Bedarf eine andere Manifest-URL anfordern
    $theme = '#ffffff';
    $bg = '#ffffff';
}

$manifest = [
    'name' => 'Meinkaufszettel',
    'short_name' => 'Meinkaufszettel',
    'start_url' => '/index.php',
    'scope' => '/',
    'icons' => [
        [ 'src' => 'icon-192.png', 'type' => 'image/png', 'sizes' => '192x192' ],
        [ 'src' => 'icon-512.png', 'type' => 'image/png', 'sizes' => '512x512' ],
        [ 'src' => 'icon.svg', 'sizes' => 'any', 'type' => 'image/svg+xml' ],
    ],
    'theme_color' => $theme,
    'background_color' => $bg,
    'display' => 'standalone',
    'orientation' => 'portrait',
    'display_override' => [ 'standalone', 'window-controls-overlay' ],
];

echo json_encode($manifest, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
