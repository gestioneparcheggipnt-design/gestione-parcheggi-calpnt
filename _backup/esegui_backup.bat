@echo off
:: Script di avvio backup - viene eseguito dal Task Scheduler di Windows alle 01:00
:: Modifica il percorso di Python se necessario

echo Avvio backup parcheggi...
cd /d "C:\Users\admin\Documents\Gestione Parcheggi CalPnt\_backup"
"C:\Users\admin\AppData\Local\Python\pythoncore-3.14-64\python.exe" backup_parcheggi.py >> "C:\Users\admin\Documents\Gestione Parcheggi CalPnt\_backup\log.txt" 2>&1
echo Backup terminato.
