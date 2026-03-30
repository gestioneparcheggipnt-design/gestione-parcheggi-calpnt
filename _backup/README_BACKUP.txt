══════════════════════════════════════════════════════════════
  ISTRUZIONI SETUP BACKUP GIORNALIERO PARCHEGGI
══════════════════════════════════════════════════════════════

COSA FA:
  Ogni notte alle 01:00 esporta tutti i dati da Firestore
  (posti e storico) in un file JSON e lo carica su Google Drive.
  Il file viene nominato con la data del giorno precedente
  (es. 2025-01-15.json).

══════════════════════════════════════════════════════════════
STEP 1 — Crea la cartella di lavoro
══════════════════════════════════════════════════════════════
Crea la cartella:  C:\Users\admin\Documents\Gestione Parcheggi CalPnt\_backup\

Metti dentro:
  - backup_parcheggi.py
  - esegui_backup.bat

══════════════════════════════════════════════════════════════
STEP 2 — Installa Python (se non ce l'hai)
══════════════════════════════════════════════════════════════
Scarica Python da: https://www.python.org/downloads/
Durante l'installazione spunta "Add Python to PATH".

Poi apri il Prompt dei comandi e installa le librerie:
  pip install firebase-admin google-auth google-auth-httplib2 google-api-python-client

══════════════════════════════════════════════════════════════
STEP 3 — Scarica la Service Account Key da Firebase
══════════════════════════════════════════════════════════════
1. Vai su https://console.firebase.google.com
2. Seleziona il progetto "gestione-parcheggi-calpnt"
3. Clicca sull'ingranaggio ⚙️ → "Impostazioni progetto"
4. Tab "Account di servizio"
5. Clicca "Genera nuova chiave privata" → Scarica il file JSON
6. Rinominalo "serviceAccount.json"
7. Mettilo in C:\Users\admin\Documents\Gestione Parcheggi CalPnt\_backup\

══════════════════════════════════════════════════════════════
STEP 4 — Abilita Google Drive API
══════════════════════════════════════════════════════════════
1. Vai su https://console.cloud.google.com
2. Seleziona il progetto "gestione-parcheggi-calpnt"
3. Menu → "API e servizi" → "Libreria"
4. Cerca "Google Drive API" e clicca "Abilita"

══════════════════════════════════════════════════════════════
STEP 5 — Crea la cartella su Google Drive e condividila
══════════════════════════════════════════════════════════════
1. Vai su https://drive.google.com
2. Crea una nuova cartella, es. "Backup Parcheggi"
3. Clicca destro sulla cartella → "Condividi"
4. Aggiungi come editor l'email della Service Account
   (la trovi dentro il file serviceAccount.json al campo "client_email")
   Es: firebase-adminsdk-xxxxx@gestione-parcheggi-calpnt.iam.gserviceaccount.com
5. Apri la cartella e copia l'ID dall'URL:
   https://drive.google.com/drive/folders/QUESTO_E_L_ID
6. Incolla quell'ID nel file backup_parcheggi.py alla riga:
   DRIVE_FOLDER_ID = "INCOLLA_QUI_L_ID_DELLA_CARTELLA_DRIVE"

══════════════════════════════════════════════════════════════
STEP 6 — Verifica il percorso di Python nel file .bat
══════════════════════════════════════════════════════════════
Apri esegui_backup.bat e controlla questa riga:
  "C:\Python312\python.exe"

Se Python è installato in una versione diversa, aggiorna il percorso.
Per trovare il percorso esatto, apri il Prompt e digita:
  where python

══════════════════════════════════════════════════════════════
STEP 7 — Prova manuale
══════════════════════════════════════════════════════════════
Prima di schedulare, fai una prova manuale:
  1. Apri il Prompt dei comandi
  2. Vai nella cartella: cd C:\Users\admin\Documents\Gestione Parcheggi CalPnt\_backup
  3. Esegui: python backup_parcheggi.py
  4. Verifica che su Google Drive appaia il file JSON

══════════════════════════════════════════════════════════════
STEP 8 — Schedula con Task Scheduler (ogni notte alle 01:00)
══════════════════════════════════════════════════════════════
1. Premi WIN+R → digita "taskschd.msc" → OK
2. Nel pannello di destra clicca "Crea attività di base..."
3. Nome: "Backup Parcheggi"
4. Trigger: "Ogni giorno" → ora: 01:00
5. Azione: "Avvia programma"
   Programma: C:\Users\admin\Documents\Gestione Parcheggi CalPnt\_backup\esegui_backup.bat
6. Spunta "Apri la finestra di dialogo Proprietà al termine"
7. Nella finestra Proprietà → tab "Generale":
   Spunta "Esegui che l'utente sia connesso o meno"
   Spunta "Esegui con i privilegi più elevati"
8. Clicca OK e inserisci la password di Windows se richiesta

══════════════════════════════════════════════════════════════
VERIFICA LOG
══════════════════════════════════════════════════════════════
Ogni esecuzione viene registrata in:
  C:\Users\admin\Documents\Gestione Parcheggi CalPnt\_backup\log.txt

Aprilo per controllare se il backup è andato a buon fine.

══════════════════════════════════════════════════════════════
