<?php
/**
 * Sendet eine JSON-Fehlermeldung und beendet das Skript.
 * @param string $message Die Fehlermeldung.
 * @param int $httpCode Der HTTP-Statuscode (Standard: 400).
 */
function sendError(string $message, int $httpCode = 400): void {
    http_response_code($httpCode);
    echo json_encode(['success' => false, 'error' => $message]);
    exit;
}


/**
 * Stellt sicher, dass $rel nicht über das Basisverzeichnis $base hinausgeht.
 * @param string $base Das Basisverzeichnis (z.B. userDir). MUSS ein echtes Verzeichnis sein.
 * @param string $rel Der relative Pfad (z.B. 'list.json' oder '../hacked.json').
 * @return bool True, wenn $rel innerhalb von $base liegt.
 */
function validatePath(string $base, string $rel): bool {
    // Keine Manipulation erlauben
    if (strpos($rel, '..') !== false || strpos($rel, '/') !== false || strpos($rel, '\\') !== false) {
        return false;
    }
    
    $fullPath = $base . '/' . $rel;
    $realBase = realpath($base);
    $realFull = realpath($fullPath);
    
    // Nicht existierende Pfade prüfen
    if ($realFull === false) {
        $dir = dirname($fullPath);
        if (realpath($dir) === false || strpos(realpath($dir), $realBase) !== 0) {
            return false;
        }
    } else {
        if (strpos($realFull, $realBase) !== 0) {
            return false;
        }
    }
    
    return true;
}

/**
 * Wandelt einen Unix-Timestamp in eine verständliche Zeitangabe um.
 * @param int $timestamp Der Unix-Timestamp.
 * @return string Die verständliche Zeitangabe (HTML-escaped).
 */
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

/**
 * Atomisch eine Datei ersetzen (tmp -> rename).
 * Vereinfachte Variante ohne spezielle Symlink-Behandlung (Hardlinks erwartet).
 */
function atomicReplaceFile(string $path, string $content): bool {
    // Wenn $path ein Symlink ist, arbeite auf dem Ziel der Symlink
    $target = $path;
    if (is_link($path)) {
        $linkTarget = readlink($path);
        if ($linkTarget === false) return false;
        if ($linkTarget[0] !== '/') {
            $target = dirname($path) . '/' . $linkTarget;
        } else {
            $target = $linkTarget;
        }
    }

    $targetDir = dirname($target);
    if (!is_dir($targetDir) && !@mkdir($targetDir, 0750, true)) return false;

    // Wenn die Datei bereits existiert und mehrere Hardlinks hat, schreibe IN-PLACE
    // damit andere Hardlinks den neuen Inhalt sehen.
    if (file_exists($target)) {
        $st = @stat($target);
        $nlink = 1;
        if ($st !== false) {
            $nlink = isset($st['nlink']) ? (int)$st['nlink'] : (isset($st[3]) ? (int)$st[3] : 1);
        }
        if ($nlink > 1) {
            $fp = @fopen($target, 'c+');
            if ($fp === false) return false;
            if (!flock($fp, LOCK_EX)) { fclose($fp); return false; }
            if (!ftruncate($fp, 0)) { flock($fp, LOCK_UN); fclose($fp); return false; }
            rewind($fp);
            $written = fwrite($fp, $content);
            fflush($fp);
            flock($fp, LOCK_UN);
            fclose($fp);
            @chmod($target, 0640);
            return $written !== false;
        }
    }

    // Standard: atomischer Austausch via tmp -> rename
    $tmp = $targetDir . '/.' . basename($target) . '.tmp-' . bin2hex(random_bytes(6));
    $written = @file_put_contents($tmp, $content, LOCK_EX);
    if ($written === false) {
        @unlink($tmp);
        return false;
    }
    @chmod($tmp, 0640);

    if (!@rename($tmp, $target)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

/**
 * Atomisch eine Datei schreiben (tmp -> rename).
 */
function atomicWrite(string $path, string $content): bool {
    $dir = dirname($path);
    if (!is_dir($dir) && !@mkdir($dir, 0750, true)) return false;
    $tmp = $dir . '/.' . basename($path) . '.tmp-' . bin2hex(random_bytes(6));
    if (@file_put_contents($tmp, $content, LOCK_EX) === false) { @unlink($tmp); return false; }
    @chmod($tmp, 0640);
    if (!@rename($tmp, $path)) { @unlink($tmp); return false; }
    return true;
}

/** 
* Bereinigen Sie einen vom Benutzer bereitgestellten Anzeigenamen und lassen Sie gleichzeitig Emojis zu. 
* Schritte: 
* – Leerzeichen entfernen 
* – Entfernen Sie ASCII-Steuerzeichen (0x00-0x1F, 0x7F), um Injektions-/Formatierungsprobleme zu vermeiden 
* – Wenn möglich auf NFC normalisieren 
* – Reduzieren Sie wiederholte Leerzeichen in einzelne Leerzeichen und entfernen Sie CR/LF 
* – Erzwingen Sie eine maximale Länge in Zeichen (UTF-8-fähig) 
* Gibt die bereinigte Zeichenfolge zurück (kann leer sein, wenn die Eingabe nur ungültige Zeichen umfasst). 
*/
function sanitizeDisplayName(string $input): string {
    // Trim
    $s = trim($input);
    if ($s === '') return '';

    // Remove ASCII control chars (keep Unicode formatting like ZWJ for emojis)
    $s = preg_replace('/[\x00-\x1F\x7F]+/u', '', $s);
    if ($s === null) $s = '';

    // Remove CR/LF and replace with space
    $s = str_replace(["\r", "\n"], ' ', $s);

    // Collapse multiple whitespace into single space
    $s = preg_replace('/\s+/u', ' ', $s);
    if ($s === null) $s = '';

    // Unicode normalize to NFC if ext available
    if (class_exists('Normalizer') && defined('Normalizer::FORM_C')) {
        $s = Normalizer::normalize($s, Normalizer::FORM_C) ?: $s;
    }

    // Trim again after replacements
    $s = trim($s);

    // Max length (characters, UTF-8 aware). Use grapheme if available.
    $max = 512;
    if (function_exists('grapheme_strlen')) {
        if (grapheme_strlen($s) > $max) {
            $s = grapheme_substr($s, 0, $max);
        }
    } else {
        if (mb_strlen($s, 'UTF-8') > $max) {
            $s = mb_substr($s, 0, $max, 'UTF-8');
        }
    }

    return $s;
}

/**
 * Erzeugt ein Share-Token und legt eine Tokendatei im $sharesDir an.
 * Rückgabe: der Token-String (Dateiname).
 */
function shareList(string $username, string $filename): string {
    global $usersDir, $sharesDir, $filenameMatch, $usernameMatch;

    if (!preg_match($usernameMatch, $username)) sendError('Ungültiger Benutzer.', 400);
    if (!preg_match($filenameMatch, $filename)) sendError('Ungültiger Listename.', 400);

    $userDir = $usersDir . '/' . $username;
    $rel = basename($filename) . '.json';
    if (!validatePath($userDir, $rel)) sendError('Ungültiger Pfad.', 400);
    $fullPath = $userDir . '/' . $rel;
    if (!file_exists($fullPath)) sendError('Liste nicht gefunden.', 404);

    if (!is_dir($sharesDir) && !@mkdir($sharesDir, 0750, true)) {
        sendError('Server-Fehler: Shares-Verzeichnis nicht verfügbar.', 500);
    }

    // Erzeuge einen einzigartigen Token (hex)
    $attempts = 0;
    do {
        $token = bin2hex(random_bytes(16));
        $safe = preg_replace('/[^a-zA-Z0-9_-]/', '', $token);
        $shareFile = $sharesDir . '/' . $safe;
        $attempts++;
    } while (file_exists($shareFile) && $attempts < 8);

    if (file_exists($shareFile)) sendError('Konnte eindeutiges Share-Token nicht erzeugen.', 500);

    $payload = json_encode([
        'sharingUser' => $username,
        'sharingFilename' => basename($filename)
    ], JSON_UNESCAPED_UNICODE);
    if ($payload === false) sendError('Server-Fehler beim JSON-Encoding.', 500);

    if (file_put_contents($shareFile, $payload, LOCK_EX) === false) {
        sendError('Konnte Share-Token nicht speichern.', 500);
    }
    @chmod($shareFile, 0640);

    return $safe;
}

/**
 * Prüft und aktualisiert das Ratelimit für eine bestimmte Aktion und Kennung.
 * @param string $action Der Name der Aktion (z.B. 'reset_request').
 * @param string $identifier Eine eindeutige Kennung (z.B. IP-Adresse oder Session-ID).
 * @param int $maxAttempts Maximale Anzahl Versuche im Zeitfenster.
 * @param int $timeWindow Zeitfenster in Sekunden.
 * @return bool True, wenn die Aktion erlaubt ist, sonst false.
 */
function checkRateLimit(string $action, string $identifier, int $maxAttempts = 5, int $timeWindow = 300): bool {
    global $rateLimitDir;

    if (!is_dir($rateLimitDir)) @mkdir($rateLimitDir, 0750, true);
    
    $hash = hash('sha256', $action . $identifier);
    $file = $rateLimitDir . '/' . $hash;
    
    $attempts = [];
    if (file_exists($file)) {
        $data = @file_get_contents($file);
        $attempts = $data ? json_decode($data, true) : [];
    }
    
    $now = time();
    $attempts = array_filter($attempts, fn($t) => $t > $now - $timeWindow);
    
    if (count($attempts) >= $maxAttempts) {
        return false;
    }
    
    $attempts[] = $now;
    @file_put_contents($file, json_encode($attempts), LOCK_EX);
    return true;
}

/**
 * Löscht/setzt das Rate-Limit für eine konkrete Aktion/Kennung zurück.
 * Rückgabe: true bei Erfolg (oder wenn nichts zu tun war), false bei Fehler.
 */
function resetRateLimit(string $action, string $identifier): bool {
    global $rateLimitDir;

    if (!is_dir($rateLimitDir)) return true;

    // Verwende die gleiche Dateinamenslogik wie in checkRateLimit (kompatibel bleiben)
    $hash = hash('sha256', $action . $identifier);
    $file = $rateLimitDir . '/' . $hash;

    if (!file_exists($file)) return true;

    return @unlink($file);
}

/**
 * Entfernt alle Rate-Limit-Dateien, deren Name mit dem gegebenen Action-Präfix beginnt.
 * Nützlich, um z.B. nach erfolgreichem Login alle zugehörigen Einträge (ip/user) zu löschen.
 * Gibt die Anzahl gelöschter Dateien zurück.
 */
function resetRateLimitsByAction(string $actionPrefix): int {
    global $rateLimitDir;
    $deleted = 0;
    if (!is_dir($rateLimitDir)) return $deleted;

    $dh = @opendir($rateLimitDir);
    if ($dh === false) return $deleted;
    while (false !== ($entry = readdir($dh))) {
        if ($entry === '.' || $entry === '..') continue;
        if (strpos($entry, $actionPrefix) === 0) {
            $path = $rateLimitDir . '/' . $entry;
            if (is_file($path) && @unlink($path)) $deleted++;
        }
    }
    closedir($dh);
    return $deleted;
}

/**
 * Stellt sicher, dass die benötigten Basis-Verzeichnisse existieren und beschreibbar sind.
 * Bei Fehlern wird `sendError` aufgerufen (HTTP 500).
 */
function ensureRequiredDirectories(): void {
    global $dataDirBase, $invitesDir, $usersDir, $sharesDir, $resetsDir, $rateLimitDir, $tmpDir;

    if (!is_dir($dataDirBase) && !@mkdir($dataDirBase, 0750, true)) {
        sendError('Server-Fehler: Speicher-Basisverzeichnis nicht verfügbar.', 500);
    }
    if (!is_writable($dataDirBase)) {
        sendError('Speicher-Basisverzeichnis ist nicht beschreibbar.', 500);
    }
    if (!is_dir($invitesDir) && !@mkdir($invitesDir, 0750, true)) {
        sendError('Server-Fehler: Einladungs-Verzeichnis nicht verfügbar.', 500);
    }
    if (!is_writable($invitesDir)) {
        sendError('Einladungs-Verzeichnis ist nicht beschreibbar.', 500);
    }
    if (!is_dir($usersDir) && !@mkdir($usersDir, 0750, true)) {
        sendError('Server-Fehler: User-Verzeichnis nicht verfügbar.', 500);
    }
    if (!is_writable($usersDir)) {
        sendError('User-Verzeichnis ist nicht beschreibbar.', 500);
    }
    if (!is_dir($sharesDir) && !@mkdir($sharesDir, 0750, true)) {
        sendError('Server-Fehler: Verzeichnis zum Teilen von Listen nicht verfügbar.', 500);
    }
    if (!is_writable($sharesDir)) {
        sendError('Verzeichnis zum Teilen von Listen nicht ist nicht beschreibbar.', 500);
    }
    if (!is_dir($resetsDir) && !@mkdir($resetsDir, 0750, true)) {
        sendError('Server-Fehler: Resetverzeichnis nicht verfügbar.', 500);
    }
    if (!is_writable($resetsDir)) {
        sendError('Resetverzeichnis ist nicht beschreibbar.', 500);
    }
    if (!is_dir($rateLimitDir) && !@mkdir($rateLimitDir, 0750, true)) {
        sendError('Server-Fehler: Ratelimit-Verzeichnis nicht verfügbar.', 500);
    }
    if (!is_writable($rateLimitDir)) {
        sendError('Ratelimit-Verzeichnis ist nicht beschreibbar.', 500);
    }
    if (!is_dir($tmpDir) && !@mkdir($tmpDir, 0750, true)){
        sendError('Konnte temporäres Verzeichnis nicht anlegen.', 500);
    }
    if (!is_writable($tmpDir)) {
        sendError('Temporäres Verzeichnis ist nicht beschreibbar.', 500);
    }
}