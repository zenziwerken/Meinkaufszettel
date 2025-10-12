# <img src="links/icon.svg" width="48" height="48"> Meinkaufszettel
Diese schlank gehaltene Webanwendung ist meine Implementierung eines synchronisierten Einkaufszettels. Zur Installation kopieren Sie die Dateien einfach in ein Webverzeichnis, passen die Dateiberechtigungen und die `config.php` an. Hier ist insbesondere der Eintrag `$allowedOrigins` wichtig. Beim ersten Start legen Sie ein Passwort fest, das verschlüsselt im `data`-Verzeichnis gespeichert wird.

Anschließend können Sie Ihren ersten Einkaufszettel erstellen. Nach einem Klick auf den Zettel fügen Sie Einträge hinzu, die zunächst als **grüne, aktive Elemente** erscheinen.

**Verwaltung der Einträge:**\
**Bearbeiten**: Klicken Sie auf den Stift-Button, um einen Eintrag zu ändern.\
**Sortieren:** Ziehen Sie die Einträge per **Drag & Drop** anhand der drei Striche, um die Reihenfolge anzupassen.\
**Abhaken**: Ein Klick auf den **Namen** des Elements markiert es als erledigt. Es wird dann **grau hinterlegt** und nach unten verschoben.\
**Wiederherstellen/Löschen**: Inaktive, graue Elemente können Sie durch einen Klick auf den **Namen wieder aktivieren** oder mit dem **Mülleimer-Button endgültig löschen**.

# Speiseplan
Da zu einem Einkaufszettel irgenwie auch ein **Speiseplan** gehört, gibt es eine Liste mit ein paar **Sonderfunktionen**. Wird eine Liste `Speiseplan` benannt, sind die Besonderheiten aktiv. Dabei werden alle Einträge mit den komenden Wochendentagen gekennzeichnet und farblich hervorgehoben. Jweils um 20 Uhr springt diese Benennung auf den nächsten Tag um. Wenn man die Möglichkeit hat, cronjobs zu verwenden, kann man um 20 Uhr das Skript `cron.php` aufrufen. Damit wird jeweils das oberste Element aus der Liste deaktiviert.

# Screenshots
<img src="screenshots/Screenshot_1.png" height="400" style="border: 2px solid #aaa; border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.2);">
![Screenshot_1](/screenshots/Screenshot_1.png)
![Screenshot_1](/screenshots/Screenshot_2.png)
![Screenshot_1](/screenshots/Screenshot_3.png)
![Screenshot_1](/screenshots/Screenshot_4.png)
![Screenshot_1](/screenshots/Screenshot_5.png)
