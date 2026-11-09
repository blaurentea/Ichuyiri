"""Inspect all media files in c:\\repos\\Ichuyiri\\files to catalog codecs, durations, hashes, and Sikuri spectral traits."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import av
import librosa
import numpy as np
from scipy.signal import welch

FILES_DIR = Path(__file__).resolve().parent.parent / "files"


def sha256_short(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()[:12]


def decode_mono(path: Path, target_sr: int = 22050, max_sec: float = 90.0) -> tuple[np.ndarray, int, dict]:
    container = av.open(str(path))
    audio_streams = [s for s in container.streams if s.type == "audio"]
    video_streams = [s for s in container.streams if s.type == "video"]
    if not audio_streams:
        raise ValueError(f"No audio stream in {path.name}")

    astream = audio_streams[0]
    info = {
        "codec": astream.codec_context.name,
        "orig_sr": astream.rate,
        "channels": astream.channels,
        "has_video": len(video_streams) > 0,
        "duration_est": float(container.duration / av.time_base) if container.duration else None,
    }

    resampler = av.AudioResampler(format="fltp", layout="mono", rate=target_sr)
    chunks: list[np.ndarray] = []
    total_samples = 0
    max_samples = int(max_sec * target_sr)

    for frame in container.decode(astream):
        for rframe in resampler.resample(frame):
            arr = rframe.to_ndarray()[0]
            chunks.append(arr)
            total_samples += len(arr)
        if total_samples >= max_samples:
            break

    container.close()
    y = np.concatenate(chunks) if chunks else np.zeros(target_sr, dtype=np.float32)
    return y, target_sr, info


def main() -> None:
    results = []
    for p in sorted(FILES_DIR.iterdir()):
        if not p.is_file():
            continue
        try:
            y, sr, info = decode_mono(p)
            # Get full duration accurately if truncated
            dur = info["duration_est"] or (len(y) / sr)
            # Spectral profile
            freqs, psd = welch(y, fs=sr, nperseg=min(4096, len(y)))
            low_mask = (freqs >= 45) & (freqs <= 165)
            mid_mask = (freqs > 165) & (freqs <= 2500)
            bombo_peak_hz = float(freqs[low_mask][np.argmax(psd[low_mask])]) if np.any(low_mask) else 0.0
            low_energy = float(np.trapezoid(psd[low_mask], freqs[low_mask]))
            mid_energy = float(np.trapezoid(psd[mid_mask], freqs[mid_mask]))
            low_ratio = low_energy / (low_energy + mid_energy + 1e-9)

            tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
            bpm = float(np.atleast_1d(tempo)[0])

            entry = {
                "file": p.name,
                "size_kb": round(p.stat().st_size / 1024, 1),
                "hash": sha256_short(p),
                "duration_s": round(dur, 2),
                "codec": info["codec"],
                "orig_sr": info["orig_sr"],
                "has_video": info["has_video"],
                "bombo_peak_hz": round(bombo_peak_hz, 1),
                "low_band_share": round(low_ratio, 3),
                "est_bpm": round(bpm, 1),
            }
            results.append(entry)
            print(json.dumps(entry, ensure_ascii=False))
        except Exception as exc:
            print(json.dumps({"file": p.name, "error": str(exc)}))


if __name__ == "__main__":
    main()

