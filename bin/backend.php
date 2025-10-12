<?php
declare(strict_types=1);
session_start();
require __DIR__ . '/config.php';

header('Content-Type: application/json');

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$normalizedOrigin = $origin ? rtrim($origin, '/') : '';
if ($normalizedOrigin !== '' && in_array($normalizedOrigin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $normalizedOrigin);
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
} else {
    // keine CORS-Header setzen wenn Origin nicht erlaubt
}

// Preflight short-circuit
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// --- Ensure directories exist (secure perms) ---
if (!is_dir($saveDir) && !@mkdir($saveDir, 0750, true)) {
    sendError('Server-Fehler: Speicherverzeichnis nicht verfügbar.', 500);
}
if (!is_writable($saveDir)) {
    sendError('Speicherverzeichnis ist nicht beschreibbar.', 500);
}
if (!is_dir($tokenDir) && !@mkdir($tokenDir, 0750, true)) {
    sendError('Server-Fehler: Tokenverzeichnis nicht verfügbar.', 500);
}
if (!is_writable($tokenDir)) {
    sendError($tokenDir.' Tokenverzeichnis ist nicht beschreibbar.', 500);
}

// Nur POST akzeptieren
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendError('Ungültige Anfrage.', 405);
}

// Limit Content-Length early if provided
$maxRequestBytes = 16 * 1024; // 16 KB
$contentLength = isset($_SERVER['CONTENT_LENGTH']) ? (int)$_SERVER['CONTENT_LENGTH'] : null;
if ($contentLength !== null && $contentLength > $maxRequestBytes) {
    sendError('Request zu groß.', 413);
}

// Read body (sichere limit)
$input = file_get_contents('php://input', false, null, 0, $maxRequestBytes);
if ($input === false) {
    sendError('Fehler beim Lesen des Request-Körpers.', 400);
}
$data = json_decode($input, true);
if (json_last_error() !== JSON_ERROR_NONE) {
    sendError('Ungültiges JSON-Format.', 400);
}

// Hilfsfunktion: sichere Pfad-Auflösung innerhalb $saveDir
$resolveSavePath = function(string $filename): string {
    global $saveDir;
    $candidate = $saveDir . '/' . $filename . '.json';
    $real = realpath(dirname($candidate));
    if ($real === false) {
        return '';
    }
    $normalized = $real . '/' . basename($filename) . '.json';
    $saveReal = realpath($saveDir);
    if ($saveReal === false) return '';
    if (strpos($normalized, $saveReal) !== 0) return '';
    return $normalized;
};

// --- Aktionen ---
$action = $data['action'] ?? null;

if ($action === 'register') {
    if (!isset($data['password'])) {
        sendError('Passwort fehlt.', 400);
    }
    $hashedPassword = password_hash($data['password'], PASSWORD_DEFAULT);
    file_put_contents($passwordFile,$hashedPassword);
    
    $action = 'login';
}

if ($action === 'login') {
    // Validierung
    if (!isset($data['password'])) {
        sendError('Ungültige Anfrage: Passwort fehlt.', 400);
    }

    // Passwortprüfung
    if (password_verify($data['password'], $hashedPassword)) {

        // Set cookie (secure, httpOnly, sameSite=strict)
        $_SESSION['auth'] = 'true';
        setcookie('auth', 'true', [
            'expires' => time() + 15552000, // 180 Tage
            'path' => '/',
            'secure' => true,
            'httponly' => false,
            'samesite' => 'Strict'
        ]);

        // Token erzeugen (zufällig, 256 bit)
        $token = bin2hex(random_bytes(32));
        $tokenHash = hash('sha256', $token);
        $tokenFile = $tokenDir . '/' . $tokenHash;
        // Token-Hash serverseitig speichern
        if (file_put_contents($tokenFile, '-') === false) {
            sendError('Konnte Token-Datei nicht speichern.', 500);
        }
        setcookie(
            'token', $token, [
            'expires' => time() + 15552000, // 180 Tage
            'path' => '/',
            'secure' => true,
            'httponly' => true,
            'samesite' => 'Strict'
        ]);

        echo json_encode(['success' => true, 'message' => 'Login erfolgreich']);
    } else {
        sendError('Ungültiges Passwort.', 401);
    }
    exit;
}

if (!$_SESSION['auth']) {
    if (!isset($_COOKIE['token']) || !is_string($_COOKIE['token'])) {
        sendError('Nicht autorisiert. Bitte erneut anmelden.', 401);
    }
    $authToken = $_COOKIE['token'];
    $authHash  = hash('sha256', $authToken);
    $tokenFile = $tokenDir . '/' . $authHash;

    if (!file_exists($tokenFile)) {
        sendError('Nicht autorisiert. Bitte erneut anmelden.', 401);
    } else {
        $_SESSION['auth'] = 'true';
    }
}

if ($action === 'create') {
    $filename = isset($data['filename']) ? trim((string)$data['filename']) : '';
    if ($filename === '') sendError('Kein Filename angegeben.', 400);
    if (!preg_match($filenameMatch, $filename)) sendError('Ungültiger Name. Nur Buchstaben, Zahlen, "/" und Leerzeichen erlaubt.', 400);
    if (strpos($filename, '..') !== false) sendError('Ungültiger Name. Nur Buchstaben, Zahlen, "/" und Leerzeichen erlaubt.', 400);

    $fullPath = $resolveSavePath($filename);
    if (!$fullPath) sendError('Server-Fehler beim Pfadauflösen.', 500);

    // Exklusive Erstellung: fopen with 'x' (fail if exists)
    $handle = @fopen($fullPath, 'x');
    if ($handle === false) {
        sendError('Liste existiert bereits oder kann nicht erstellt werden.', 409);
    }
    // set restrictive permissions
    @chmod($fullPath, 0640);

    $emptyList = ['active' => [], 'inactive' => []];
    $jsonContent = json_encode($emptyList, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    if ($jsonContent === false) {
        @fclose($handle);
        @unlink($fullPath);
        sendError('Server-Fehler beim Erstellen der Datei.', 500);
    }
    // write with lock
    if (!flock($handle, LOCK_EX)) {
        @fclose($handle);
        @unlink($fullPath);
        sendError('Server-Fehler: Lock konnte nicht gesetzt werden.', 500);
    }
    $written = fwrite($handle, $jsonContent);
    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);
    if ($written === false) {
        @unlink($fullPath);
        sendError('Konnte Datei nicht schreiben.', 500);
    }
    echo json_encode(['success' => true, 'message' => 'Liste erfolgreich erstellt', 'filename' => basename($fullPath)]);
    exit;
}

if ($action === 'rename') {
    $filename = isset($data['oldFilename']) ? trim((string)$data['oldFilename']) : '';
    $newFilename = isset($data['newFilename']) ? trim((string)$data['newFilename']) : '';
    if ($filename === '' || $newFilename === '') sendError('Filename oder neuer Name fehlt.', 400);
    if (!preg_match($filenameMatch, $filename) || !preg_match($filenameMatch, $newFilename)) sendError('Ungültiger Name. Nur Buchstaben, Zahlen, "/" und Leerzeichen erlaubt.', 400);

    $fullPath = $resolveSavePath($filename);
    $newFullPath = $resolveSavePath($newFilename);
    if (!$fullPath || !$newFullPath) sendError('Server-Fehler beim Pfadauflösen.', 500);
    if (!file_exists($fullPath)) sendError('Liste nicht gefunden.', 404);
    if (file_exists($newFullPath)) sendError('Eine Liste mit dem neuen Namen existiert bereits.', 409);

    // rename atomisch (OS abhängig)
    if (!rename($fullPath, $newFullPath)) {
        sendError('Konnte Liste nicht umbenennen.', 500);
    }
    echo json_encode(['success' => true, 'message' => 'Liste erfolgreich umbenannt', 'filename' => basename($newFullPath)]);
    exit;
}

if ($action === 'delete') {
    $filename = isset($data['filename']) ? trim((string)$data['filename']) : '';
    if ($filename === '') sendError('Keine Liste angegeben.', 400);
    if (!preg_match($filenameMatch, $filename)) sendError('Ungültiger Name.', 400);
    $fullPath = $resolveSavePath($filename);
    if (!$fullPath) sendError('Server-Fehler beim Pfadauflösen.', 500);
    if (!file_exists($fullPath)) sendError('Liste nicht gefunden.', 404);
    if (!unlink($fullPath)) sendError('Konnte Liste nicht löschen.', 500);
    echo json_encode(['success' => true, 'message' => 'Liste erfolgreich gelöscht', 'filename' => basename($fullPath)]);
    exit;
}

if ($action === 'list') {
    // Safely iterate files in saveDir
    $saveReal = realpath($saveDir);
    if ($saveReal === false) sendError('Speicherverzeichnis nicht vorhanden.', 500);
    $files = glob($saveReal . '/*.json');
    $list = [];
    foreach ($files as $file) {
        $filename = basename($file, '.json');
        $jsonContent = @file_get_contents($file);
        if ($jsonContent === false) {
            // skip or log; hier Fehler zurückgeben könnte die gesamte Liste blockieren
            continue;
        }
        $jsonData = json_decode($jsonContent, true);
        $itemCount = 0;
        if (isset($jsonData['active']) && is_array($jsonData['active'])) $itemCount += count($jsonData['active']);
        $list[] = [
            'filename' => $filename,
            'itemCount' => $itemCount,
            'lastModified' => verstaendlicheZeitangabe( filemtime($file)),
        ];
    }
    echo json_encode($list);
    exit;
}

if ($action === 'load') {
    $id = isset($data['id']) ? trim((string)$data['id']) : '';
    if (!preg_match($filenameMatch, $id)) sendError('Ungültige Liste.', 400);
    $fullPath = $resolveSavePath($id);
    if (!$fullPath) sendError('Server-Fehler beim Pfadauflösen.', 500);
    if (!file_exists($fullPath)) sendError('Liste nicht gefunden.', 404);
    $jsonContent = @file_get_contents($fullPath);
    if ($jsonContent === false) sendError('Fehler beim Lesen der Liste.', 500);
    // echo raw JSON (file should be trusted because we control writes)
    echo $jsonContent;
    exit;
}

if ($action === 'save') {
    $filename = isset($data['filename']) ? trim((string)$data['filename']) : '';
    $active = $data['active'] ?? null;
    $inactive = $data['inactive'] ?? null;

    if (!is_array($active) || !is_array($inactive)) sendError('Active und Inactive müssen Arrays sein.', 400);
    if (!preg_match($filenameMatch, $filename)) sendError('Ungültiger Name. Nur Buchstaben, Zahlen, "/" und Leerzeichen erlaubt.', 400);
    if (count($active) > $maxItemsPerList || count($inactive) > $maxItemsPerList) sendError("Zu viele Einträge in der Liste. Nur $maxItemsPerList Einträge pro Liste erlaubt", 400);

    // Validate items: type and length
    foreach (['active' => $active, 'inactive' => $inactive] as $k => $arr) {
        foreach ($arr as $i => $item) {
            if (!is_string($item) && !is_numeric($item)) {
                sendError("Ungültiger Eintrag in $k[$i].", 400);
            }
            $s = (string)$item;
            if (mb_strlen($s) > $maxItemLength) {
                sendError("Ein Eintrag in $k ist zu lang. Nur $maxItemLength Zeichen erlaubt.", 400);
            }
        }
    }

    $items = ['active' => array_values($active), 'inactive' => array_values($inactive)];
    $jsonContent = json_encode($items, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    if ($jsonContent === false) sendError('Server-Fehler beim JSON-Encoding.', 500);

    $fullPath = $resolveSavePath($filename);
    if (!$fullPath) sendError('Server-Fehler beim Pfadauflösen.', 500);

    // Atomic write: write to tmp file then rename
    $tmp = $fullPath . '.tmp-' . bin2hex(random_bytes(6));
    $written = file_put_contents($tmp, $jsonContent, LOCK_EX);
    if ($written === false) {
        @unlink($tmp);
        sendError('Konnte Liste nicht speichern.', 500);
    }
    // ensure restrictive permissions
    @chmod($tmp, 0640);
    // atomic rename
    if (!rename($tmp, $fullPath)) {
        @unlink($tmp);
        sendError('Konnte Liste nicht umbenennen.', 500);
    }

    $totalItems = count($items['active']) + count($items['inactive']);
    echo json_encode([
        'success' => true,
        'filename' => basename($fullPath),
        'message' => 'Liste erfolgreich als JSON gespeichert',
        'itemCount' => $totalItems
    ]);
    exit;
}

sendError('Ungültige Daten empfangen', 400);

// ----------------- Hilfsfunktionen -----------------
function sendError(string $message, int $httpCode = 400): void {
    //global $input;
    //error_log('Error: ' . $message."\n".$input);
    http_response_code(202);
    echo json_encode(['success' => false, 'error' => $message]);
    exit;
}

function verstaendlicheZeitangabe($timestamp) {
    $jetzt = time();
    $diff = $jetzt - $timestamp;
    
    // In Minuten umrechnen
    $minuten = floor($diff / 60);
    $stunden = floor($diff / 3600);
    $tage = floor($diff / 86400);
    
    if ($minuten < 5) {
        return "gerade&nbsp;eben&nbsp;geändert";
    } elseif ($minuten < 15) {
        return "vor&nbsp;kurzem&nbsp;geändert";
    } elseif ($minuten < 60) {
        return "in&nbsp;der letzten Stunde geändert";
    } elseif ($stunden < 24) {
        return "vor&nbsp;" . $stunden . "&nbsp;Stunde" . ($stunden != 1 ? "n" : "") . "&nbsp;geändert";
    } elseif ($stunden < 48)  {
        return "gestern&nbsp;geändert";
    } else {
        return "vor&nbsp;" . $tage . "&nbsp;Tag" . ($tage != 1 ? "en" : "") . "&nbsp;geändert";
    }
}