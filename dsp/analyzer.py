"""
Ichuyiri MIR & DSP Engine v3.0 — Sikuri de Varios Bombos Edition.

Key Acoustic & Rhythmic Upgrades over v2.1:
  1. Zero-Phase 50/60/100/120 Hz AC Mains Hum Notch Bank:
     Eliminates South American 50 Hz / 60 Hz electrical hum that previously hijacked bass peak detection.
  2. High-Resolution Bass HPSS (11,025 Hz -> 5.38 Hz/bin @ n_fft=2048):
     Separates broadband percussive cuero strikes from sustained Toyo & Sanka bass panpipe notes (65–160 Hz),
     which previously accounted for 19%–78% of raw low-frequency energy and caused false kick/accent labels.
  3. Dual-Gated Positive Rise Flux + Courtyard Slapback Echo Suppression:
     Blocks panpipe-only silence ghosts and -16..-22 dB street/courtyard wall echoes (135–275 ms post-blow)
     while preserving genuine Sikuri repiques and corchea cells.
  4. True Physical Kick / Punch (`acento`) Classifier (Zero Percentile Forcing):
     Measures fresh injected cuero displacement (ΔE = post_peak - 0.75 * pre_valley) + 10ms impact attack slope
     strictly within the percussive bombo band, normalized against local non-subdivision main beats. Steady
     walking passages remain clean `pulso` notes; `acento` is reserved for genuine physical kicks, cadential
     half-note blows, strong-weak metrical downbeats, and structural `Corte` closures.
"""
from __future__ import annotations

import json
import math
import re
import time
from pathlib import Path
from typing import Any

import av
import librosa
import numpy as np
import soundfile as sf
from scipy.ndimage import percentile_filter, uniform_filter1d
from scipy.signal import butter, find_peaks, iirnotch, resample_poly, sosfiltfilt, tf2sos, welch


TARGET_SR = 44100
MIR_DOWNSAMPLE = 4
MIR_SR = TARGET_SR // MIR_DOWNSAMPLE  # 11,025 Hz -> 5.38 Hz FFT bin resolution at n_fft=2048
MIR_HOP = 55  # 4.99 ms envelope frame resolution at 11,025 Hz


def slugify(name: str) -> str:
    stem = Path(name).stem.lower()
    stem = re.sub(r"[^a-z0-9]+", "-", stem).strip("-")
    return stem or "sikuri-track"


def decode_audio_mono(path: Path, target_sr: int = TARGET_SR) -> tuple[np.ndarray, str]:
    """Decode any media container (.mpeg, .mp4, .ogg, .wav, .mp3) into normalized mono float32."""
    container = av.open(str(path))
    audio_streams = [s for s in container.streams if s.type == "audio"]
    if not audio_streams:
        container.close()
        raise ValueError(f"No audio stream found in {path}")

    astream = audio_streams[0]
    codec_name = astream.codec_context.name or "unknown"
    resampler = av.AudioResampler(format="fltp", layout="mono", rate=target_sr)
    chunks: list[np.ndarray] = []

    for packet in container.demux(astream):
        try:
            for frame in packet.decode():
                for rframe in resampler.resample(frame):
                    chunks.append(rframe.to_ndarray()[0])
        except Exception:
            continue

    container.close()
    if not chunks:
        raise ValueError(f"Decoded empty audio from {path}")

    y = np.concatenate(chunks).astype(np.float32)
    peak = float(np.max(np.abs(y)))
    if peak > 1e-6:
        y = (y / peak) * 0.94
    return y, codec_name


def encode_master_audio(
    y: np.ndarray,
    sr: int,
    out_stem_no_ext: Path,
    bitrate: int = 192_000,
    overwrite: bool = False,
) -> str:
    """Encode pristine untouched mono MP3 at 192 kbps (reusing existing master file when overwrite=False)."""
    mp3_path = out_stem_no_ext.with_suffix(".mp3")
    wav_path = out_stem_no_ext.with_suffix(".wav")
    if not overwrite:
        if mp3_path.exists() and mp3_path.stat().st_size > 16_384:
            return mp3_path.name
        if wav_path.exists() and wav_path.stat().st_size > 16_384:
            return wav_path.name

    try:
        container = av.open(str(mp3_path), mode="w")
        stream = container.add_stream("mp3", rate=sr)
        stream.bit_rate = bitrate
        stream.layout = "mono"

        y_clipped = np.clip(y, -1.0, 1.0).astype(np.float32)
        frame_size = stream.codec_context.frame_size or 1152

        for start in range(0, len(y_clipped), frame_size):
            chunk = y_clipped[start : start + frame_size]
            frame = av.AudioFrame.from_ndarray(chunk.reshape(1, -1), format="fltp", layout="mono")
            frame.sample_rate = sr
            for packet in stream.encode(frame):
                container.mux(packet)

        for packet in stream.encode(None):
            container.mux(packet)

        container.close()
        return mp3_path.name
    except Exception:
        if mp3_path.exists():
            mp3_path.unlink(missing_ok=True)
        sf.write(str(wav_path), np.clip(y, -1.0, 1.0), sr, subtype="PCM_16")
        return wav_path.name


def zero_phase_bandpass(y: np.ndarray, low_hz: float, high_hz: float, sr: int, order: int = 4) -> np.ndarray:
    nyq = 0.5 * sr
    low = max(18.0, low_hz) / nyq
    high = min(nyq * 0.94, high_hz) / nyq
    sos = butter(order, [low, high], btype="bandpass", output="sos")
    return sosfiltfilt(sos, y).astype(np.float32)


def remove_mains_hum(y: np.ndarray, sr: int) -> np.ndarray:
    """Zero-phase narrow Q=32 notch bank removing 50 Hz & 60 Hz AC hum and 100/120 Hz 2nd harmonics."""
    out = y.astype(np.float64)
    for f0 in (50.0, 60.0, 100.0, 120.0):
        if f0 < 0.45 * sr:
            b, a = iirnotch(f0, Q=32.0, fs=sr)
            out = sosfiltfilt(tf2sos(b, a), out)
    return out.astype(np.float32)


def run_matlab_v1_baseline(y: np.ndarray, sr: int) -> dict[str, Any]:
    """Exact reproduction of the original MATLAB V1 algorithm for quantitative benchmarking."""
    x_filtro = zero_phase_bandpass(y, 80.0, 150.0, sr, order=4)
    win = max(1, round(0.030 * sr))
    energia = np.sqrt(np.maximum(0.0, uniform_filter1d(x_filtro.astype(np.float64) ** 2, size=win, mode="nearest")))
    max_e = float(np.max(energia)) if len(energia) else 0.0
    if max_e < 1e-9:
        return {"hit_count": 0, "times": []}

    min_dist = max(1, round(0.20 * sr))
    peaks, _ = find_peaks(energia, prominence=0.15 * max_e, distance=min_dist)
    times = [round(float(p / sr), 3) for p in peaks]
    return {
        "hit_count": len(times),
        "times": times,
    }


def estimate_sikuri_pulse_grid(iois: np.ndarray) -> tuple[float, float]:
    """
    Estimate (modal_stroke_ioi, quarter_beat_sec) from clean bombo inter-onset intervals.
    Handles both steady quarter-note marches (0.37–0.62s), bimodal ♩♫ figures, and fast corchea trotes (~0.24s).
    """
    valid = iois[(iois >= 0.18) & (iois <= 0.78)]
    if len(valid) < 5:
        return 0.43, 0.43

    bins = np.linspace(0.18, 0.78, 61)  # 10ms bins
    hist, edges = np.histogram(valid, bins=bins)
    smooth = np.convolve(hist, [0.25, 0.5, 0.25], mode="same")

    best_idx = int(np.argmax(smooth))
    modal_center = 0.5 * (edges[best_idx] + edges[best_idx + 1])
    near_modal = valid[np.abs(valid - modal_center) <= 0.032]
    base_ioi = float(np.median(near_modal)) if len(near_modal) > 0 else float(modal_center)

    # Check specifically for a strong quarter-note beat cluster in [0.35s, 0.66s] (91–171 BPM)
    q_mask = (edges[:-1] >= 0.35) & (edges[:-1] <= 0.66)
    if base_ioi < 0.34 and np.any(q_mask):
        q_sub = smooth[q_mask]
        q_edges = edges[:-1][q_mask]
        q_best = int(np.argmax(q_sub))
        q_cand = float(q_edges[q_best] + 0.005)
        # If the song has a clear ♩♫ cell where quarter ≈ 2 * eighth, lock onto the true quarter beat
        if q_sub[q_best] >= 0.28 * smooth[best_idx] and abs(q_cand - 2.0 * base_ioi) <= 0.08:
            near_q = valid[np.abs(valid - q_cand) <= 0.038]
            quarter_sec = float(np.median(near_q)) if len(near_q) > 0 else q_cand
            return base_ioi, quarter_sec

    quarter_sec = base_ioi * 2.0 if base_ioi < 0.34 else base_ioi
    return base_ioi, quarter_sec


def detect_sikuri_bombo_events(
    y_44k: np.ndarray,
    sr_44k: int,
    codec_name: str = "",
) -> tuple[list[dict[str, Any]], float, float, list[dict[str, float]], list[dict[str, float]], list[float]]:
    """
    MIR v3.0 Bombo & Kick/Punch Recognition Pipeline for Sikuri de Varios Bombos.
    Returns (events, resonant_hz, global_bpm, bpm_curve, spectrum_points, bombo_waveform).
    """
    if len(y_44k) < sr_44k // 2:
        return [], 100.0, 120.0, [], [], []

    # 1. Downsample 4x -> 11,025 Hz & notch 50/60/100/120 Hz electrical hum
    y_mir = resample_poly(y_44k, 1, MIR_DOWNSAMPLE).astype(np.float32)
    y_mir = remove_mains_hum(y_mir, MIR_SR)

    # 2. High-Resolution STFT HPSS (2048 FFT @ 11,025 Hz = 5.38 Hz/bin, 10ms hop)
    #    350ms horizontal median strips sustained Toyo & Sanka bass panpipe notes;
    #    11-bin (~59 Hz) vertical median preserves broadband cuero membrane impacts.
    stft_mat = librosa.stft(y_mir, n_fft=2048, hop_length=110)
    _, stft_perc = librosa.decompose.hpss(stft_mat, kernel_size=(35, 11), power=2.0, margin=(1.0, 1.45))
    y_perc = librosa.istft(stft_perc, hop_length=110, length=len(y_mir)).astype(np.float32)

    # 3. Calibrate TRUE percussive cuero resonance peak on y_perc (immune to Sanka/Toyo pitches & AC hum)
    freqs, psd_perc = welch(y_perc, fs=MIR_SR, nperseg=min(4096, len(y_perc)))
    sub_mask = (freqs >= 44.0) & (freqs <= 138.0)
    upper_mask = (freqs > 138.0) & (freqs <= 215.0)
    e_sub = float(np.trapezoid(psd_perc[sub_mask], freqs[sub_mask])) if np.any(sub_mask) else 0.0
    e_upper = float(np.trapezoid(psd_perc[upper_mask], freqs[upper_mask])) if np.any(upper_mask) else 0.0

    is_bass_rolled_off = codec_name == "opus" or (e_sub < 0.32 * e_upper)

    if is_bass_rolled_off:
        pk_mask = (freqs >= 72.0) & (freqs <= 180.0)
        resonant_hz = float(freqs[pk_mask][np.argmax(psd_perc[pk_mask])]) if np.any(pk_mask) else 132.0
        low_lo = 60.0
        low_hi = 175.0
    else:
        resonant_hz = float(freqs[sub_mask][np.argmax(psd_perc[sub_mask])]) if np.any(sub_mask) else 105.0
        # Always include 42..58 Hz floor for bombos mayores while keeping ceiling <= 136 Hz below Malta/Ira pipes
        low_lo = max(38.0, min(58.0, resonant_hz - 38.0))
        low_hi = min(136.0, max(116.0, resonant_hz + 28.0))

    # Zero-phase percussive cuero fundamental signal
    y_bombo = zero_phase_bandpass(y_perc, low_lo, low_hi, MIR_SR, order=4)

    # Clean perceptual bombo waveform (240 bins) for UI scrubber
    wf_bins = 240
    chunk_len = max(1, len(y_bombo) // wf_bins)
    wf_raw = np.array(
        [float(np.sqrt(np.mean(y_bombo[i : i + chunk_len] ** 2))) for i in range(0, len(y_bombo), chunk_len)][:wf_bins],
        dtype=np.float64,
    )
    wf_p98 = float(np.percentile(wf_raw, 98)) + 1e-8
    waveform = [round(float(np.clip(v / wf_p98, 0.06, 1.0)), 3) for v in wf_raw]

    # Diagnostic percussive spectrum (25–320 Hz) for SettingsDrawer
    spec_mask = (freqs >= 25.0) & (freqs <= 320.0)
    spec_freqs = freqs[spec_mask]
    spec_psd = psd_perc[spec_mask]
    spec_max = float(np.max(spec_psd)) + 1e-12
    spectrum_points = [
        {"hz": round(float(f), 1), "db": round(float(np.clip(10.0 * np.log10(v / spec_max + 1e-6), -45.0, 0.0)), 1)}
        for f, v in zip(spec_freqs, spec_psd)
    ]

    # 4. Compute 22ms zero-phase RMS envelope & 20ms positive rise flux at 4.99ms frame step
    hop_rate = MIR_SR / MIR_HOP  # ~200.45 Hz
    win_samples = max(1, int(0.022 * MIR_SR))
    sq_smooth = uniform_filter1d(y_bombo.astype(np.float64) ** 2, size=win_samples, mode="nearest")
    env = np.sqrt(np.maximum(0.0, sq_smooth[::MIR_HOP]))

    if len(env) < 12 or float(np.max(env)) < 1e-7:
        return [], round(resonant_hz, 1), 120.0, [], spectrum_points, waveform

    lag = 4  # ~20 ms rise window
    env_prev = np.concatenate([np.repeat(env[0], lag), env[:-lag]])
    flux = np.maximum(0.0, env - 0.82 * env_prev)

    # Instantaneous 10ms attack slope inside the pure bombo band (captures sharp mazo strike velocity)
    env_prev_fast = np.concatenate([np.repeat(env[0], 2), env[:-2]])
    slope_10ms = np.maximum(0.0, env - env_prev_fast)

    win_5s = max(30, int(5.0 * hop_rate))
    glob_env_p95 = float(np.percentile(env, 95))
    loc_env_p94 = np.maximum(percentile_filter(env, percentile=94, size=win_5s, mode="nearest"), 0.28 * glob_env_p95)

    glob_flux_p95 = float(np.percentile(flux, 95))
    loc_flux_p94 = np.maximum(
        percentile_filter(flux, percentile=94, size=win_5s, mode="nearest"),
        0.28 * glob_flux_p95,
    )

    norm_flux = flux / (loc_flux_p94 + 1e-9)

    # Candidate peaks (135ms refractory window allows rapid repiques while blocking skin double-triggers)
    min_dist_frames = max(1, int(0.135 * hop_rate))
    raw_peaks, _ = find_peaks(norm_flux, distance=min_dist_frames, prominence=0.21, height=0.27)

    if len(raw_peaks) == 0:
        return [], round(resonant_hz, 1), 120.0, [], spectrum_points, waveform

    # 5. Dual-Gated Validation:
    #    Gate A: Rejects panpipe-only silence ghosts (where bombo envelope is near noise floor)
    #    Gate B: Rejects -14..-22 dB street/courtyard slapback echoes (135–295 ms after a strong blow)
    accepted_peaks: list[int] = []
    accepted_pk_env: list[float] = []
    accepted_fresh: list[float] = []
    accepted_slope: list[float] = []
    onset_times: list[float] = []

    for p_raw in raw_peaks:
        p = int(p_raw)
        s_pre = max(0, p - 5)  # -25 ms pre-onset valley search
        e_post = min(len(env), p + 6)  # +30 ms post-onset peak search

        valley_val = float(np.min(env[s_pre : p + 1]))
        pk_val = float(np.max(env[p:e_post]))
        fresh_val = max(0.0, pk_val - 0.75 * valley_val)
        pk_slope = float(np.max(slope_10ms[max(0, p - 1) : min(len(slope_10ms), p + 3)]))

        # Gate A: Minimum absolute & local cuero energy
        min_pk_req = max(0.19 * glob_env_p95, 0.26 * float(loc_env_p94[p]))
        min_fresh_req = max(0.15 * glob_env_p95, 0.21 * float(loc_env_p94[p]))
        if pk_val < min_pk_req or fresh_val < min_fresh_req:
            continue

        # Sub-frame 50% rise impact alignment (lands dead-on physical mazo contact with cuero)
        pk_rel_idx = p + int(np.argmax(env[p:e_post]))
        half_target = valley_val + 0.50 * (pk_val - valley_val)
        impact_frame = float(p)
        for k in range(pk_rel_idx, s_pre, -1):
            if env[k - 1] <= half_target <= env[k]:
                denom = float(env[k] - env[k - 1])
                frac = (half_target - float(env[k - 1])) / denom if denom > 1e-9 else 0.5
                impact_frame = (k - 1) + float(np.clip(frac, 0.0, 1.0))
                break
        t_cand = max(0.0, impact_frame / hop_rate)

        # Gate B: Exponential forward-masking against courtyard wall slapback & shell secondary ring
        if accepted_peaks:
            dt_prev = t_cand - onset_times[-1]
            if dt_prev < 0.135:
                if fresh_val > accepted_fresh[-1] * 1.15:
                    accepted_peaks[-1] = p
                    accepted_pk_env[-1] = pk_val
                    accepted_fresh[-1] = fresh_val
                    accepted_slope[-1] = pk_slope
                    onset_times[-1] = t_cand
                continue

            if dt_prev < 0.295:
                decay = math.exp(-(dt_prev - 0.135) / 0.22)
                req_fresh = 0.36 * decay * accepted_fresh[-1]
                req_pk = 0.38 * decay * accepted_pk_env[-1]
                if fresh_val < req_fresh or pk_val < req_pk:
                    continue

        accepted_peaks.append(p)
        accepted_pk_env.append(pk_val)
        accepted_fresh.append(fresh_val)
        accepted_slope.append(pk_slope)
        onset_times.append(t_cand)

    if not accepted_peaks:
        return [], round(resonant_hz, 1), 120.0, [], spectrum_points, waveform

    times = np.array(onset_times, dtype=np.float64)
    fresh_arr = np.array(accepted_fresh, dtype=np.float64)
    slope_arr = np.array(accepted_slope, dtype=np.float64)

    # Initial pulse grid estimate for two-sided beat-bridge echo pruning
    init_iois = np.diff(times)
    _, init_quarter_sec = estimate_sikuri_pulse_grid(init_iois)

    # Gate C: Two-Sided Beat-Bridge Echo Pruner
    # If a weak intermediate hit sits inside a single quarter-note span (t[i+1] - t[i-1] ≈ 1 beat),
    # it is a courtyard reflection or breath artifact splitting a single beat -> prune it.
    keep_mask = np.ones(len(times), dtype=bool)
    for i in range(1, len(times) - 1):
        if not keep_mask[i - 1]:
            continue
        span = float(times[i + 1] - times[i - 1])
        if 0.74 * init_quarter_sec <= span <= 1.24 * init_quarter_sec:
            if fresh_arr[i] < 0.44 * max(fresh_arr[i - 1], fresh_arr[i + 1]):
                keep_mask[i] = False

    times = times[keep_mask]
    fresh_arr = fresh_arr[keep_mask]
    slope_arr = slope_arr[keep_mask]

    # 6. Physical Kick Power = 65% Fresh Cuero Displacement + 35% 10ms Attack Velocity Slope
    f_ref = float(np.percentile(fresh_arr, 90)) + 1e-9
    s_ref = float(np.percentile(slope_arr, 90)) + 1e-9
    kick_power = 0.65 * (fresh_arr / f_ref) + 0.35 * (slope_arr / s_ref)
    norm_weights = np.clip(kick_power, 0.22, 1.0)

    # 7. Musical Pulse Grid & Smooth BPM(t) Curve
    iois = np.diff(times)
    base_ioi, quarter_sec = estimate_sikuri_pulse_grid(iois)
    global_bpm = round(60.0 / quarter_sec, 1)

    duration = len(y_44k) / sr_44k
    bpm_curve: list[dict[str, float]] = []
    for t_win in np.arange(0.0, duration, 2.0):
        if len(times) > 2:
            mask_t = (times[:-1] >= t_win - 4.0) & (times[:-1] <= t_win + 4.0)
            local_d = iois[mask_t]
            q_near = local_d[(local_d >= 0.76 * quarter_sec) & (local_d <= 1.28 * quarter_sec)]
            e_near = local_d[(local_d >= 0.38 * quarter_sec) & (local_d <= 0.64 * quarter_sec)]
            if len(q_near) >= 2:
                local_bpm = 60.0 / float(np.median(q_near))
            elif len(e_near) >= 3:
                local_bpm = 60.0 / (2.0 * float(np.median(e_near)))
            else:
                local_bpm = global_bpm
        else:
            local_bpm = global_bpm
        bpm_curve.append({"t": round(float(t_win), 2), "bpm": round(local_bpm, 1)})

    # 8. Phrase-Aware Rhythm & True Physical Kick (`acento`) Classifier
    corte_gap_sec = max(1.25, 2.35 * quarter_sec)
    phrases: list[list[int]] = [[0]]
    for i in range(1, len(times)):
        if (times[i] - times[i - 1]) >= corte_gap_sec:
            phrases.append([i])
        else:
            phrases[-1].append(i)

    kinds = ["pulso"] * len(times)
    is_corte_flags = [False] * len(times)

    for ph in phrases:
        if len(ph) == 1:
            idx0 = ph[0]
            kinds[idx0] = "acento" if float(kick_power[idx0]) >= 0.55 else "pulso"
            is_corte_flags[idx0] = False
            continue

        # Local base stroke interval for this phrase (distinguishes occasional ♫ repiques from steady corchea trote)
        ph_iois = np.diff(times[ph])
        ph_valid = ph_iois[(ph_iois >= 0.17) & (ph_iois <= 0.78)]
        ph_med_ioi = float(np.median(ph_valid)) if len(ph_valid) >= 3 else quarter_sec
        fast_share = float(np.mean(ph_valid < 0.70 * quarter_sec)) if len(ph_valid) >= 4 else 0.0
        ref_sub_grid = ph_med_ioi if fast_share >= 0.60 else quarter_sec

        # Identify main-beat strokes vs rapid subdivision (repique) strokes inside the phrase.
        # In a ♫♩ (ta-ta-BOOM) cell, the two short strokes (dt_next < 0.68 * grid) are repiques,
        # while the resolving stroke on the beat (dt_next >= 0.74 * grid with solid weight) is pulso/acento!
        is_sub = [False] * len(ph)
        for pos, i in enumerate(ph):
            dt_prev = float(times[i] - times[i - 1]) if pos > 0 else 999.0
            dt_next = float(times[i + 1] - times[i]) if pos + 1 < len(ph) else 999.0

            near_idx = [k for k in ph if abs(times[k] - times[i]) <= 4.5]
            near_p60 = float(np.percentile(kick_power[near_idx], 60)) if near_idx else float(kick_power[i])

            short_next = dt_next < 0.67 * ref_sub_grid
            short_prev = dt_prev < 0.67 * ref_sub_grid

            if short_next and float(kick_power[i]) < 1.05 * near_p60:
                is_sub[pos] = True
            elif short_prev and dt_next < 0.74 * ref_sub_grid and float(kick_power[i]) < 1.05 * near_p60:
                is_sub[pos] = True
            elif short_prev and float(kick_power[i]) < 0.68 * near_p60:
                # Light trailing grace tap after a main beat
                is_sub[pos] = True

        main_positions = [pos for pos, sub in enumerate(is_sub) if not sub]
        main_indices = [ph[pos] for pos in main_positions]

        # Test whether the main beats of this phrase exhibit genuine Strong-Weak metrical alternation (BOOM - boom)
        alt_strong_parity: int | None = None
        if len(main_indices) >= 6:
            even_kp = kick_power[main_indices[0::2]]
            odd_kp = kick_power[main_indices[1::2]]
            med_e = float(np.median(even_kp))
            med_o = float(np.median(odd_kp))
            if med_e >= 1.30 * med_o:
                alt_strong_parity = 0
            elif med_o >= 1.30 * med_e:
                alt_strong_parity = 1

        ph_duration = float(times[ph[-1]] - times[ph[0]])

        for pos, i in enumerate(ph):
            t_hit = float(times[i])
            dt_next = float(times[i + 1] - t_hit) if pos + 1 < len(ph) else 999.0

            # Local main-beat reference (never skewed downward by light repique subdivisions!)
            loc_mains = [k for k in main_indices if abs(times[k] - t_hit) <= 4.5]
            if len(loc_mains) >= 3:
                loc_ref = float(np.median(kick_power[loc_mains])) + 1e-9
                loc_low = float(np.percentile(kick_power[loc_mains], 30)) + 1e-9
            else:
                near_all = [k for k in ph if abs(times[k] - t_hit) <= 4.5]
                loc_ref = float(np.percentile(kick_power[near_all], 60)) + 1e-9
                loc_low = float(np.percentile(kick_power[near_all], 30)) + 1e-9

            k_ratio = float(kick_power[i]) / loc_ref

            # Compare against the weaker adjacent main beat so 2-beat kick pairs (BOOM-BOOM-boom-boom)
            # do not cancel each other out!
            prev_candidates = [k for k in main_indices if k < i]
            next_candidates = [k for k in main_indices if k > i]
            prev_kp = float(kick_power[prev_candidates[-1]]) if prev_candidates else loc_low
            next_kp = float(kick_power[next_candidates[0]]) if next_candidates else loc_low
            weaker_neigh = min(prev_kp, next_kp) + 1e-9
            contrast_vs_weak = float(kick_power[i]) / weaker_neigh

            # A true structural Corte closes a real musical phrase (>= 6 strokes and >= 3.8s long)
            is_phrase_end = (
                (pos == len(ph) - 1)
                and (i < len(times) - 1)
                and (len(ph) >= 6)
                and (ph_duration >= 3.8)
            )
            if is_phrase_end and k_ratio >= 0.80:
                is_corte_flags[i] = True
                kinds[i] = "acento"
                continue

            if is_sub[pos]:
                kinds[i] = "repique"
                continue

            # Cadential half-note blow inside a phrase (e.g. held 2-beat cadence in Sikuri Marcha)
            is_cadential_hold = (1.68 * quarter_sec <= dt_next < corte_gap_sec) and (k_ratio >= 1.04)

            main_ord = main_positions.index(pos) if pos in main_positions else -1

            if is_cadential_hold:
                kinds[i] = "acento"
            elif alt_strong_parity is not None:
                if main_ord % 2 == alt_strong_parity and k_ratio >= 1.12 and contrast_vs_weak >= 1.20:
                    kinds[i] = "acento"
                elif k_ratio >= 1.38 and contrast_vs_weak >= 1.28:
                    kinds[i] = "acento"
                else:
                    kinds[i] = "pulso"
            else:
                # Even-pulse or call phrase: mark genuine physical kicks (+1.8 dB over median & +1.7 dB over weak neighbor)
                if k_ratio >= 1.23 and contrast_vs_weak >= 1.22:
                    kinds[i] = "acento"
                elif pos == 0 and k_ratio >= 1.18 and float(kick_power[i]) >= 1.18 * next_kp:
                    kinds[i] = "acento"
                else:
                    kinds[i] = "pulso"

    events: list[dict[str, Any]] = [
        {
            "id": idx,
            "t": round(float(times[idx]), 3),
            "kind": kinds[idx],
            "weight": round(float(norm_weights[idx]), 3),
            "isCorte": bool(is_corte_flags[idx]),
        }
        for idx in range(len(times))
    ]

    return events, round(resonant_hz, 1), global_bpm, bpm_curve, spectrum_points, waveform


def segment_sections(events: list[dict[str, Any]], duration: float) -> list[dict[str, Any]]:
    """Identify up to 6 major musical sections separated by structural Cortes (>= 18s minimum section length)."""
    if not events:
        return [{"id": "sec-0", "name": "Completa", "start": 0.0, "end": round(duration, 2)}]

    min_sec_len = max(14.0, duration / 6.2)
    boundaries = [0.0]
    for i in range(len(events) - 1):
        gap = events[i + 1]["t"] - events[i]["t"]
        if gap >= 1.35 and (events[i]["t"] - boundaries[-1]) >= min_sec_len and (duration - events[i]["t"]) >= 10.0:
            boundaries.append(round(events[i]["t"] + 0.35, 2))
            if len(boundaries) >= 6:
                break
    boundaries.append(round(duration, 2))

    if len(boundaries) <= 2 and duration > 32.0:
        n_parts = min(6, max(3, int(round(duration / 28.0))))
        step = round(duration / n_parts, 1)
        boundaries = [round(k * step, 2) for k in range(n_parts)] + [round(duration, 2)]

    labels = ["Entrada", "Primera Parte", "Corte / Llamada", "Segunda Parte", "Quimba / Fuga", "Remate Final"]
    sections: list[dict[str, Any]] = []
    for idx in range(len(boundaries) - 1):
        s_start = boundaries[idx]
        s_end = boundaries[idx + 1]
        label = labels[idx] if idx < len(labels) else f"Parte {idx + 1}"
        if idx == len(boundaries) - 2 and len(boundaries) > 3:
            label = "Remate Final"
        sections.append(
            {
                "id": f"sec-{idx}",
                "name": label,
                "start": round(float(s_start), 2),
                "end": round(float(s_end), 2),
            }
        )
    return sections


def process_track(
    audio_path: Path,
    out_root: Path,
    title: str | None = None,
    track_id: str | None = None,
    overwrite_audio: bool = False,
) -> dict[str, Any]:
    t0 = time.perf_counter()
    tid = track_id or slugify(audio_path.name)
    track_dir = out_root / tid
    track_dir.mkdir(parents=True, exist_ok=True)

    # Clean up legacy phasey HPSS stems if present
    for old_name in ("sikus.mp3", "bombos.mp3", "sikus.wav", "bombos.wav"):
        (track_dir / old_name).unlink(missing_ok=True)

    y, codec_name = decode_audio_mono(audio_path, TARGET_SR)
    duration = round(len(y) / TARGET_SR, 2)

    master_file = encode_master_audio(y, TARGET_SR, track_dir / "master", overwrite=overwrite_audio)

    events, resonant_hz, global_bpm, bpm_curve, spectrum_points, waveform = detect_sikuri_bombo_events(
        y, TARGET_SR, codec_name=codec_name
    )
    sections = segment_sections(events, duration)
    matlab_v1 = run_matlab_v1_baseline(y, TARGET_SR)

    counts = {
        "pulso": sum(1 for e in events if e["kind"] == "pulso"),
        "acento": sum(1 for e in events if e["kind"] == "acento"),
        "repique": sum(1 for e in events if e["kind"] == "repique"),
    }

    meta: dict[str, Any] = {
        "id": tid,
        "title": title or audio_path.stem,
        "sourceFile": audio_path.name,
        "style": "Sikuri de Varios Bombos",
        "duration": duration,
        "bpm": global_bpm,
        "bomboResonanceHz": resonant_hz,
        "audioUrl": f"/tracks/{tid}/{master_file}",
        "counts": {
            "total": len(events),
            **counts,
        },
        "benchmarkV1": {
            "matlabV1Hits": matlab_v1["hit_count"],
            "ichuyiriV2Hits": len(events),
            "repiquesRecovered": counts["repique"],
            "acentosClassified": counts["acento"],
        },
        "sections": sections,
        "bpmCurve": bpm_curve,
        "spectrum": spectrum_points,
        "waveform": waveform,
        "events": events,
        "processingTimeSec": round(time.perf_counter() - t0, 2),
    }

    (track_dir / "track.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    return meta


def batch_process_directory(files_dir: Path, out_root: Path, overwrite_audio: bool = False) -> list[dict[str, Any]]:
    out_root.mkdir(parents=True, exist_ok=True)
    seen_hashes: set[bytes] = set()
    catalog: list[dict[str, Any]] = []

    audio_files = sorted(
        [p for p in files_dir.iterdir() if p.is_file() and p.suffix.lower() in {".mpeg", ".mp4", ".ogg", ".wav", ".mp3"}]
    )

    idx = 1
    for path in audio_files:
        digest = Path(path).read_bytes()[:4096] + str(path.stat().st_size).encode()
        if digest in seen_hashes:
            continue
        seen_hashes.add(digest)

        track_id = f"sikuri-{idx:02d}"
        friendly_title = f"Sikuri Tropa {idx:02d}"

        try:
            print(f"[{idx}/{len(audio_files)}] Analyzing {path.name} -> {track_id}...", flush=True)
            meta = process_track(
                path,
                out_root=out_root,
                title=friendly_title,
                track_id=track_id,
                overwrite_audio=overwrite_audio,
            )
            cnt = meta["counts"]
            pa = 100.0 * cnt["acento"] / max(1, cnt["total"])
            pr = 100.0 * cnt["repique"] / max(1, cnt["total"])
            print(
                f"    -> {meta['bpm']:5.1f} BPM | cuero={meta['bomboResonanceHz']:5.1f} Hz | "
                f"total={cnt['total']:3d} | P={cnt['pulso']:3d} A={cnt['acento']:3d} ({pa:4.1f}%) R={cnt['repique']:3d} ({pr:4.1f}%) "
                f"[{meta['processingTimeSec']}s]",
                flush=True,
            )
            catalog.append(
                {
                    "id": meta["id"],
                    "title": meta["title"],
                    "sourceFile": meta["sourceFile"],
                    "duration": meta["duration"],
                    "bpm": meta["bpm"],
                    "bomboResonanceHz": meta["bomboResonanceHz"],
                    "counts": meta["counts"],
                    "benchmarkV1": meta["benchmarkV1"],
                    "trackUrl": f"/tracks/{meta['id']}/track.json",
                }
            )
            idx += 1
        except Exception as exc:
            print(f"  ! Skipped {path.name}: {exc}", flush=True)

    (out_root / "catalog.json").write_text(json.dumps(catalog, indent=2, ensure_ascii=False), encoding="utf-8")
    return catalog


if __name__ == "__main__":
    repo_root = Path(__file__).resolve().parent.parent
    src_dir = repo_root / "files"
    dest_dir = repo_root / "web" / "public" / "tracks"
    summary = batch_process_directory(src_dir, dest_dir, overwrite_audio=False)
    print(f"\nProcessed {len(summary)} Sikuri tracks with MIR v3.0 into {dest_dir}", flush=True)
