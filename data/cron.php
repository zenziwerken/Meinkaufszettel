<?php
require __DIR__ .'/../bin/config.php';
$file = __DIR__ .'/'.$speiseplanName.'.json';
if (file_exists($file)) {
    $data = json_decode(file_get_contents($file), true);
    if (!empty($data['active'])) {
        $moved = array_shift($data['active']);
        $data['inactive'][] = $moved;
        file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }
}