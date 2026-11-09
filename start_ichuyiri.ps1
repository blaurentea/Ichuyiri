Write-Host "Iniciando Ichuyiri (API MIR en :8420 + Web Trainer en :5173)..." -ForegroundColor Cyan
Start-Process -NoNewWindow -FilePath ".\.venv\Scripts\python.exe" -ArgumentList "-m uvicorn server:app --app-dir dsp --port 8420"
Set-Location web
npm.cmd run dev
