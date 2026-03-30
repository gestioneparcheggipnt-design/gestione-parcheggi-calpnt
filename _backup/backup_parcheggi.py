"""
Backup giornaliero Firestore → Google Drive
Salva i dati di 'spots' e 'history' in un file JSON nominato YYYY-MM-DD.json
(data del giorno precedente) e lo carica su Google Drive.

Requisiti:
    pip install firebase-admin google-auth google-auth-httplib2 google-api-python-client

Setup:
    1. Scarica la Service Account Key da Firebase Console (vedi istruzioni nel README)
    2. Abilita Google Drive API su Google Cloud Console
    3. Modifica le variabili SERVICE_ACCOUNT_FILE e DRIVE_FOLDER_ID qui sotto
"""

import json
import os
from datetime import datetime, timedelta

import firebase_admin
from firebase_admin import credentials, firestore
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from google.oauth2 import service_account

# ── CONFIGURAZIONE ────────────────────────────────────────────────────────────
# Percorso al file JSON della Service Account (scaricato da Firebase Console)
SERVICE_ACCOUNT_FILE = r"C:\Users\admin\Documents\Gestione Parcheggi CalPnt\_backup\serviceAccount.json"

# ID della cartella Google Drive dove salvare i backup
# (apri la cartella su Drive e copia l'ID dall'URL: drive.google.com/drive/folders/QUESTO_ID)
DRIVE_FOLDER_ID = "1KYRGX1P1jdQD9D6cksANQYMf8MNp9TDe"

# Cartella locale temporanea dove viene creato il file prima dell'upload
LOCAL_TEMP_DIR = r"C:\Users\admin\Documents\Gestione Parcheggi CalPnt\_backup\temp"
# ─────────────────────────────────────────────────────────────────────────────


def get_yesterday_str():
    """Restituisce la data di ieri nel formato YYYY-MM-DD."""
    yesterday = datetime.now() - timedelta(days=1)
    return yesterday.strftime("%Y-%m-%d")


def export_firestore(db):
    """Esporta tutte le collezioni rilevanti da Firestore in un dizionario."""
    print("  Esportazione collezione 'spots'...")
    spots = {}
    for doc in db.collection("spots").stream():
        data = doc.to_dict()
        # Converti Timestamp in stringa ISO
        for key, val in data.items():
            if hasattr(val, "isoformat"):
                data[key] = val.isoformat()
        spots[doc.id] = data

    print("  Esportazione collezione 'history'...")
    history = []
    for doc in db.collection("history").order_by("ts").stream():
        data = doc.to_dict()
        for key, val in data.items():
            if hasattr(val, "isoformat"):
                data[key] = val.isoformat()
        data["_id"] = doc.id
        history.append(data)

    print(f"  Trovati {len(spots)} posti e {len(history)} movimenti storici.")
    return {"spots": spots, "history": history}


def save_local(data, filename):
    """Salva il dizionario come file JSON locale."""
    os.makedirs(LOCAL_TEMP_DIR, exist_ok=True)
    filepath = os.path.join(LOCAL_TEMP_DIR, filename)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"  File salvato localmente: {filepath}")
    return filepath


def upload_to_drive(filepath, filename, folder_id):
    """Carica il file su Google Drive nella cartella specificata."""
    scopes = ["https://www.googleapis.com/auth/drive.file"]
    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, scopes=scopes
    )
    service = build("drive", "v3", credentials=creds)

    file_metadata = {
        "name": filename,
        "parents": [folder_id],
    }
    media = MediaFileUpload(filepath, mimetype="application/json")
    uploaded = service.files().create(
        body=file_metadata, media_body=media, fields="id, name"
    ).execute()
    print(f"  File caricato su Drive: {uploaded['name']} (ID: {uploaded['id']})")
    return uploaded


def main():
    date_str = get_yesterday_str()
    filename = f"{date_str}.json"

    print(f"\n{'='*50}")
    print(f"  BACKUP PARCHEGGI - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  File: {filename}")
    print(f"{'='*50}")

    # Inizializza Firebase Admin
    print("\n[1/4] Connessione a Firebase...")
    cred = credentials.Certificate(SERVICE_ACCOUNT_FILE)
    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("  Connessione riuscita.")

    # Esporta dati
    print("\n[2/4] Esportazione dati Firestore...")
    data = export_firestore(db)

    # Salva localmente
    print("\n[3/4] Salvataggio file locale...")
    filepath = save_local(data, filename)

    # Carica su Drive
    print("\n[4/4] Upload su Google Drive...")
    upload_to_drive(filepath, filename, DRIVE_FOLDER_ID)

    # Rimuovi file temporaneo locale
    os.remove(filepath)
    print(f"  File temporaneo rimosso.")

    print(f"\n✓ Backup completato con successo!\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n✗ ERRORE: {e}")
        raise
