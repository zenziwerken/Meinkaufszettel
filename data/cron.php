<?php
require __DIR__ .'/../bin/config.php';
$file = __DIR__ .'/'.$speiseplanName.'.json';
if (file_exists($file)) {
    $data = json_decode(file_get_contents($file), true);
    if (!empty($data['active'])) {
        $moved = array_shift($data['active']);
        $data['inactive'][] = $moved;
        $historyFile = __DIR__ .'/history.txt';
        $movedString = is_scalar($moved) ? $moved : json_encode($moved, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $entry = date('Y-m-d') . "\t" . $movedString;
        file_put_contents($historyFile, $entry . PHP_EOL, FILE_APPEND | LOCK_EX);
        file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }
}
// Garbage collection: remove token files older than 60 days
$tokensDir = __DIR__ . '/tokens';
if (is_dir($tokensDir)) {
    $threshold = time() - 60 * 24 * 60 * 60; // 60 days
    foreach (glob($tokensDir . '/*') as $tokenFile) {
        if (!is_file($tokenFile)) continue;
        $mtime = filemtime($tokenFile);
        if ($mtime !== false && $mtime < $threshold) {
            @unlink($tokenFile);
        }
    }
}