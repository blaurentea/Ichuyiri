# Ichuyiri — System Architecture (`Sikuri de Varios Bombos`)

This document outlines the production architecture replacing the initial MATLAB scripts, designed specifically for **Sikuri de varios bombos** practice with **immediate real-time microphone listening**.

## 1. High-Level System Architecture

```mermaid
flowchart TB
    subgraph Source["Rehearsal & Field Recordings"]
        RAW["Audio Files (.mpeg / .mp4 / .ogg / .wav)"]
    end

    subgraph PythonMIR["Stage A: Python DSP & MIR Engine (dsp/)"]
        DEC["PyAV Multi-Codec Decoder (44.1 kHz Mono)"]
        HPSS["Harmonic-Percussive Source Separation (HPSS)"]
        LOW["Low Resonance Band (50–160 Hz Cuero Weight)"]
        HIGH["Transient Flux Band (180–1400 Hz Mazo Attack)"]
        ADAPT["Adaptive Local MAD Peak Detector (80ms Lockout)"]
        CLASS["3-Tier Classifier (Pulso / Acento-Corte / Repique) + BPM(t)"]
    end

    subgraph Pack["Portable .ichuyiri Song Pack"]
        STEM_S["sikus.wav (Harmonic Ira/Arka Stem)"]
        STEM_B["bombos.wav (Percussive Bombo Stem)"]
        JSON["track.json (Beats, Dynamics, Repiques, Sections)"]
    end

    subgraph BrowserPWA["Stage B: Installable Web PWA & Live Coach (web/)"]
        CLOCK["Web Audio Clock + Pitch-Preserving Stem Mixer (0.5x–1.15x)"]
        CANVAS["60 FPS Look-Ahead Highway (2.0s Visual Horizon)"]
        MIC["Raw Mic Input (AGC / NoiseSuppression / EchoCancel OFF)"]
        WORKLET["AudioWorklet Onset Thread (128-sample / 2.67ms Quantum)"]
        CAL["Latency Compensator (t_real = t_mic - ΔL)"]
        SCORE["Groove & Dynamic Coach (Timing Offset ms + Accent Contrast)"]
    end

    RAW --> DEC --> HPSS
    HPSS -->|"Harmonic"| STEM_S
    HPSS -->|"Percussive"| STEM_B
    HPSS -->|"Percussive Analysis"| LOW & HIGH
    LOW & HIGH --> ADAPT --> CLASS --> JSON

    STEM_S & STEM_B --> CLOCK
    JSON --> CLOCK & CANVAS & SCORE
    CLOCK --> CANVAS

    MIC --> WORKLET --> CAL --> SCORE
    CLOCK -.->|"Shared AudioContext.currentTime"| CAL
```

---

## 2. Live Microphone & Latency Compensation Sequence

Because a Sikuri percussionist strikes a **physical bombo or practice pad** (which produces instant acoustic sound in the room), Ichuyiri achieves **±5 ms rhythmic scoring precision** on standard laptops and phones without needing studio ASIO hardware:

```mermaid
sequenceDiagram
    participant P as Sikuri Musician (Bombo + Siku)
    participant UI as 2.0s Look-Ahead Canvas
    participant AC as Web Audio Clock (Stem Mixer)
    participant AW as AudioWorklet (Mic Thread)
    participant SC as Groove & Accent Scorer

    Note over P,SC: One-Time 5-Tap Calibration measures Device Mic Delay (ΔL ≈ 18–45 ms)
    AC->>UI: Render approaching Pulso / Repique / Corte (t - 2.0s to t)
    UI->>P: Visual cue approaches strike zone
    P->>AW: Physical Mazo Strike on Bombo (raw PCM, voice filters OFF)
    AW->>AW: Dual-band flux exceeds adaptive threshold (2.67ms resolution)
    AW->>SC: postMessage({ micTime, lowBodyEnergy, attackPeak })
    SC->>SC: True Hit Time = (micTime - ΔL) mapped to track timeline
    SC->>UI: Instant Feedback (Locked-In ±35ms / Early / Late + Accent Match)
```

