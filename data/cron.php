<?php
if (php_sapi_name() !== 'cli') { http_response_code(403); exit; }
require __DIR__ .'/../bin/config.php';

// Durchsuche alle Benutzerverzeichnisse und wende die Speiseplan-Rotation an.
if (is_dir($usersDir)) {
    // Merke bereits verarbeitete Inodes, damit nur das erste Vorkommen pro
    // Inode verändert wird (bei Hardlinks teilen mehrere Pfade dieselbe Inode).
    $seenInodes = [];
    foreach (glob($usersDir . '/*', GLOB_ONLYDIR) as $userDir) {
        // Erwartetes Speiseplan-File im jeweiligen Benutzerverzeichnis
        $file = $userDir . '/' . $speiseplanName . '.json';

        if (!file_exists($file)) continue;
        $st = @stat($file);
        if ($st === false) continue;
        // Prüfe Inode; wenn bereits verarbeitet, überspringen.
        $inode = isset($st['ino']) ? (string)$st['ino'] : null;
        if ($inode !== null) {
            if (isset($seenInodes[$inode])) continue;
            // Markiere als gesehen — das erste Vorkommen wird verarbeitet.
            $seenInodes[$inode] = true;
        }

        $content = @file_get_contents($file);
        if ($content === false) continue;
        $data = json_decode($content, true);
        if (!is_array($data)) continue;

        if (!empty($data['active']) && is_array($data['active'])) {
            $moved = array_shift($data['active']);
            if (!isset($data['inactive']) || !is_array($data['inactive'])) $data['inactive'] = [];
            $data['inactive'][] = $moved;

            // Schreibe History in die user-spezifische history.txt
            $historyFile = $userDir . '/history.txt';
            $movedString = is_scalar($moved) ? $moved : json_encode($moved, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            $entry = date('Y-m-d') . "\t" . $movedString;
            @file_put_contents($historyFile, $entry . PHP_EOL, FILE_APPEND | LOCK_EX);

            // Schreibe die geänderte Liste zurück
            @file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        }
    }
}

// Cleanup für alte Token-Dateien in den Token-Verzeichnissen
if (is_dir($usersDir)) {
    $cleanupDays = isset($userTokenCleanupDays) ? (int)$userTokenCleanupDays : 60;
    $threshold = time() - $cleanupDays * 24 * 60 * 60;
    foreach (glob($usersDir . '/*', GLOB_ONLYDIR) as $userDir) {
        $tokensDir = $userDir . '/tokens';
        if (!is_dir($tokensDir)) continue;
        foreach (glob($tokensDir . '/*') as $tokenFile) {
            if (!is_file($tokenFile)) continue;
            $mtime = filemtime($tokenFile);
            if ($mtime !== false && $mtime < $threshold) {
                @unlink($tokenFile);
            }
        }
    }
}

// Cleanup für Passwort-Reset-Tokens im globalen resets-Verzeichnis
if (isset($resetsDir) && is_dir($resetsDir)) {
    $now = time();
    $keepDays = isset($invalidResetKeepDays) ? (int)$invalidResetKeepDays : 30;
    // Entferne Token, deren expiresAt in der Vergangenheit liegt.
    foreach (glob($resetsDir . '/*') as $tfile) {
        if (!is_file($tfile)) continue;
        $raw = @file_get_contents($tfile);
        $data = $raw ? json_decode($raw, true) : null;
        if (is_array($data) && isset($data['expiresAt'])) {
            if ($now > (int)$data['expiresAt']) {
                @unlink($tfile);
            }
            continue;
        }
        // Falls die Datei kein valides JSON enthält, lösche sie nur wenn älter als configured Tage
        $mtime = filemtime($tfile);
        if ($mtime !== false && $mtime < ($now - $keepDays * 24 * 60 * 60)) {
            @unlink($tfile);
        }
    }
}

// Cleanup für Rate-Limit-Dateien (erzeugt von checkRateLimit)
if (isset($rateLimitDir) && is_dir($rateLimitDir)) {
    $now = time();
    // Standard: 7 Tage Aufbewahrung für Rate-Limit-Dateien
    $keepDays = isset($rateLimitCleanupDays) ? (int)$rateLimitCleanupDays : 7;
    $threshold = $now - ($keepDays * 24 * 60 * 60);
    foreach (glob($rateLimitDir . '/*') as $rfile) {
        if (!is_file($rfile)) continue;
        $mtime = filemtime($rfile);
        if ($mtime !== false && $mtime < $threshold) {
            @unlink($rfile);
        }
    }
}


// Erstelle ein  ZIP-Backup der Benutzerdaten im $backupsDir
if (is_dir($usersDir)) {
    if (!is_dir($backupsDir)) {
        @mkdir($backupsDir, 0755, true);
    }

    if (class_exists('ZipArchive')) {
        $date = date('Y-m-d');
        $zipFile = rtrim($backupsDir, '/') . '/users_' . $date . '.zip';
        $tmpZipFile = rtrim($backupsDir, '/') . '/users_' . $date . '_tmp.zip';

        $zip = new ZipArchive();
        if ($zip->open($tmpZipFile, ZipArchive::CREATE | ZipArchive::OVERWRITE) === true) {
            $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($usersDir, RecursiveDirectoryIterator::SKIP_DOTS));
            foreach ($it as $file) {
                $filePath = $file->getPathname();
                if ($filePath === false) continue;
                if ($file->isLink() || !$file->isFile()) {
                    continue;
                }
                $relativePath = ltrim(
                    str_replace($usersDir, '', $filePath),
                    DIRECTORY_SEPARATOR
                );

                // Prüfe Dateigröße
                if (filesize($filePath) > 100 * 1024 * 1024) { // 100MB
                    error_log("Datei zu groß: " . $relativePath);
                    continue;
                }
                $zip->addFile($filePath, $relativePath);
            }
            $zip->close();
            if (!rename($tmpZipFile, $zipFile)) {
                @unlink($tmpZipFile);
            }
        } else {
            @unlink($tmpZipFile);
        }
        // Wende die Backup-Retention-Policy an
        applyBackupRetention($backupsDir, 7, 4, 12);
    }
}

/**
 * Backup-Aufbewahrungsrichtlinie anwenden.
 *
 * @param string $backupDir Verzeichnis mit ZIP-Backup-Dateien
 * @param int    $keepDaily Anzahl der täglich aufzubewahrenden Backups
 * @param int    $keepWeekly Anzahl der wöchentlich aufzubewahrenden Backups
 * @param int    $keepMonthly Anzahl der monatlich aufzubewahrenden Backups
 */
function applyBackupRetention(
    string $backupDir,
    int $keepDaily = 7,
    int $keepWeekly = 4,
    int $keepMonthly = 12
): void {
    $pattern = rtrim($backupDir, '/') . '/users_*.zip';
    $files = glob($pattern);
    if ($files === false || empty($files)) {
        return;
    }

    $now = time();
    $backups = [];

    // Zeitstempel analysieren
    foreach ($files as $file) {
        if (preg_match('/users_(\d{4}-\d{2}-\d{2})\.zip$/',basename($file),$m)) {
            $dt = DateTime::createFromFormat('Y-m-d', $m[1]);
            if ($dt !== false) {
                $backups[] = [
                    'file' => $file,
                    'ts'   => $dt->getTimestamp(),
                ];
            }
        }
    }

    if (empty($backups)) {
        return;
    }

    // Neueste zuerst sortieren
    usort($backups, fn($a, $b) => $b['ts'] <=> $a['ts']);

    $keep = [];

    $dailyLimit   = $now - ($keepDaily   * 86400);
    $weeklyLimit  = $now - (($keepDaily + $keepWeekly * 7) * 86400);
    $monthlyLimit = (new DateTimeImmutable())->modify("-{$keepMonthly} months")->getTimestamp();

    $daily = [];
    $weekly = [];
    $monthly = [];

    foreach ($backups as $b) {
        $ts = $b['ts'];

        // DAILY
        if ($ts >= $dailyLimit) {
            $key = date('Y-m-d', $ts);
            if (!isset($daily[$key])) {
                $daily[$key] = $b['file'];
                $keep[$b['file']] = true;
            }
            continue;
        }

        // WEEKLY (ISO week)
        if ($ts >= $weeklyLimit) {
            $key = date('o-W', $ts); // ISO year-week
            if (!isset($weekly[$key])) {
                $weekly[$key] = $b['file'];
                $keep[$b['file']] = true;
            }
            continue;
        }

        // MONTHLY
        if ($ts >= $monthlyLimit) {
            $key = date('Y-m', $ts);
            if (!isset($monthly[$key])) {
                $monthly[$key] = $b['file'];
                $keep[$b['file']] = true;
            }
            continue;
        }
    }

    // Alles löschen, was nicht zum Behalten markiert ist
    foreach ($backups as $b) {
        if (!isset($keep[$b['file']])) {
            if (is_file($b['file'])) {
                unlink($b['file']);
            }
        }
    }
}
