<?php
// index.php
require __DIR__ . '/bin/config.php';

// --- Dynamische Werte vorbereiten ---
$isFirstStart = !file_exists($passwordFile);
$listName     = array_keys($_GET)[0] ?? null;
$isSpeiseplan = ($listName === $speiseplanName);
$cssSpeiseplan = ($isSpeiseplan) ? 'class="speiseplan"' : '';
$listNameOutput = htmlspecialchars(str_replace(['_', '~'], [' ', '/'], $listName));

// --- Stylesheet-Versioning ---
$styleVersion = date("Y-m-d_H-i-s", filemtime('links/style.css'));
$scriptVersion = date("Y-m-d_H-i-s", filemtime('bin/frontend.js'));

// --- Dynamisches CSS für Speiseplan ---
$speiseplanCss = '';
if ($isSpeiseplan) {
    $currentHour = date('H');
    $startIndex = date('N') - 1; // Montag=0, Sonntag=6
    if ($currentHour >= 20) {
        $startIndex = ($startIndex + 1) % 7;
    }

    ob_start();
    echo "<style>\n";
    for ($i = 0; $i < 7; $i++) {
        $dayIndex = ($startIndex + $i) % 7;
        $dayAbbr = $germanDays[$dayIndex];
        $cssIndex = $i + 1;
        echo "        #itemList li.speiseplan:nth-of-type(7n+{$cssIndex}):before { content: '{$dayAbbr}';}\n";
        echo "        #itemList li.speiseplan:nth-of-type(7n+{$cssIndex}) { background: {$colors[$dayIndex]}; border-color: {$colorBorder[$dayIndex]}}\n";
    }
    echo "    </style>\n";
    $speiseplanCss = ob_get_clean();
}
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="manifest" href="links/website.manifest" crossorigin="use-credentials">
    <link rel="stylesheet" href="links/style.css?<?= $styleVersion ?>">
    <link rel="icon" type="image/svg+xml" href="links/icon.svg" />
    <title>Meinkaufszettel</title>
    <?= $speiseplanCss ?>
</head>
<body>
    <div class="container">

        <?php if ($isFirstStart): ?>
            <!-- Registrierung -->
            <div id="register">
                <span class="icon"></span>
                <h1>Erster Start</h1>
                <div>
                    <input type="text" id="passCode" placeholder="Passwort">
                    <button id="registerBtn">Festlegen</button>
                </div>
            </div>
            <div id="login"></div>
            <div id="listOverview"></div>
            <div id="listElements"></div>
            <div id="status"></div>
        <?php else: ?>

            <!-- Login -->
            <div id="login">
                <span class="icon"></span>
                <h1>Meinkaufszettel</h1>
                <div>
                    <input type="password" id="passCode" placeholder="Passwort">
                    <button id="loginBtn"">Anmelden</button>
                </div>
            </div>

            <!-- Übersicht -->
            <div id="listOverview">
                <span class="close" id="logoutBtn" title="Abmelden"></span>
                <span class="icon"></span>
                <h1>Meine Zettel</h1>
                <div>
                    <input type="text" id="newListItem" placeholder="Ich gehe zu ...">
                    <button id="addListItemBtn">Hinzufügen</button>
                </div>
                <ul id="serverLists"></ul>
            </div>

            <!-- Einzelne Liste -->
            <div id="listElements">
                <span class="close" id="backBtn" title="zurück zur Übersicht"></span>
                <span class="icon"></span>
                <h1><?=$listNameOutput?></h1>
                <div>
                    <input type="text" id="newItem" placeholder="Ich brauche ...">
                    <button id="addItemBtn">Hinzufügen</button>
                </div>

                <ul id="itemList"></ul>
                <ul id="inactiveList" <?=$cssSpeiseplan?>></ul>
            </div>

            <div id="status"></div>
            <input type="text" id="filename">

        <?php endif; ?>

    </div>
    <script>
        const speiseplanName = <?= json_encode($speiseplanName) ?>;
    </script>
    <script src="bin/frontend.js?<?= $scriptVersion ?>"></script>
</body>
</html>
