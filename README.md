# Ichuyiri — Guía Interactiva para *Sikuri de Varios Bombos*

**Ichuyiri** transforma grabaciones reales de ensayos y pasacalles de *Sikuri de varios bombos* en sesiones interactivas de práctica con **separación de stems (Siku vs. Bombo)**, **guía visual anticipada (2.0 s)** y **escucha activa por micrófono en tiempo real (`AudioWorklet`)**.

## Arquitectura del Sistema

Consulta el diagrama detallado en [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

- **`dsp/` (Motor MIR v3.0 en Python 3)**:
  - [`dsp/analyzer.py`](./dsp/analyzer.py): Decodifica contenedores de WhatsApp/campo (`.mpeg`, `.mp4`, `.ogg`, `.wav`, `.mp3`) mediante `PyAV`, aplica filtros notch de fase cero (`50/60/100/120 Hz`), separa **Sikus/Toyos** de **Bombos (Tropa)** con **HPSS de alta resolución (`5.38 Hz/bin`)**, auto-calibra la resonancia del cuero (`38–136 Hz`), suprime ecos de patio (`Gate A/B/C`) y clasifica cada golpe en **`pulso`** (`♩`), **`acento`** (`>♩` golpe de peso), **`repique`** (`♬`) y **`corte`** (`|┃`).
  - [`dsp/server.py`](./dsp/server.py): API FastAPI (`POST /api/analyze`) en puerto `8420` para importar nuevos audios desde la aplicación web.
- **`web/` (PWA Interactiva + Escucha de Micrófono en Vivo)**:
  - [`web/public/worklets/bombo-onset-processor.js`](./web/public/worklets/bombo-onset-processor.js): `AudioWorkletProcessor` de sub-3ms (bloques de 128 muestras, sin filtros de voz WebRTC) que detecta golpes físicos de bombo, practicador o mesa.
  - [`web/src/audio/engine.ts`](./web/src/audio/engine.ts): Motor Web Audio con **ecualización paramétrica de 3 etapas en tiempo real** (Modo Karaoke de Bombo, Realce de Cuero y Solo Grave), **velocidad variable sin alterar la afinación de los sikus (`65%–100%`)** y **compensación de latencia (`ΔL ms`)**.
  - [`web/src/components/ScoreTimeline.tsx`](./web/src/components/ScoreTimeline.tsx): Partitura de percusión grabada a 60/120 FPS con horizonte anticipado de `2.8 s`, plicas, barras de corchea/semicorchea para *repiques*, acentos `>`, dobles barras de *corte* `|┃` y traza de micrófono en vivo (`MIC`).
- **`research/matlab_v1/`**: Scripts originales en MATLAB conservados como línea base experimental.

## Ejecución Rápida

### 1. Re-procesar audios en `files/` (Opcional — los 11 audios iniciales ya están procesados)
```powershell
.\.venv\Scripts\python.exe dsp\analyzer.py
```

### 2. Iniciar la Aplicación Web + Motor de Subida
```powershell
# Terminal 1: API Python MIR (puerto 8420)
.\.venv\Scripts\python.exe -m uvicorn server:app --app-dir dsp --port 8420

# Terminal 2: Entrenador Web PWA (puerto 5173)
Set-Location web
npm.cmd run dev
```
Abre `http://localhost:5173` en Chrome/Edge (o en tu celular dentro de la misma red local).
