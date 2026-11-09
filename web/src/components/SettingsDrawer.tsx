import React, { useEffect, useState } from 'react';
import type { IchuyiriAudioEngine } from '../audio/engine';
import type { MicMeterState, TrackMetadata } from '../types';

interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  engine: IchuyiriAudioEngine;
  track: TrackMetadata | null;
  bombosVol: number;
  onBombosVolChange: (v: number) => void;
  sikusVol: number;
  onSikusVolChange: (v: number) => void;
  sensitivity: number;
  onSensitivityChange: (v: number) => void;
  latencyMs: number;
  onLatencyChange: (ms: number) => void;
  meter: MicMeterState;
}

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
  isOpen,
  onClose,
  engine,
  track,
  bombosVol,
  onBombosVolChange,
  sikusVol,
  onSikusVolChange,
  sensitivity,
  onSensitivityChange,
  latencyMs,
  onLatencyChange,
  meter,
}) => {
  const [calibrating, setCalibrating] = useState(false);
  const [calibMsg, setCalibMsg] = useState(
    'Golpee el bombo junto a los 8 pulsos de prueba para calcular el retardo de hardware.',
  );

  useEffect(() => {
    if (!isOpen) {
      setCalibrating(false);
      engine.stopCalibrationMode();
    }
  }, [isOpen, engine]);

  if (!isOpen) return null;

  const runCalibration = async () => {
    try {
      if (!engine.isMicActive) {
        await engine.enableMicrophone();
      }
      setCalibrating(true);
      setCalibMsg('Escuche 2 pulsos y acompañe los siguientes...');

      const beats = engine.scheduleCalibrationClicks(8, 0.65);
      const offsets: number[] = [];

      const unsub = engine.onOnset((onset) => {
        let best = 999;
        for (const bt of beats) {
          const d = onset.audioTime - bt;
          if (Math.abs(d) < Math.abs(best)) best = d;
        }
        const ms = Math.round(best * 1000);
        if (ms >= -40 && ms <= 220) offsets.push(ms);
      });

      window.setTimeout(() => {
        unsub();
        setCalibrating(false);
        engine.stopCalibrationMode();

        if (offsets.length >= 3) {
          const sorted = [...offsets].sort((a, b) => a - b);
          const med = Math.max(0, Math.min(180, sorted[Math.floor(sorted.length / 2)]));
          onLatencyChange(med);
          setCalibMsg(`COMPLETADO: ${med} MS (${offsets.length} MUESTRAS).`);
        } else {
          setCalibMsg('MUESTRAS INSUFICIENTES. SUBA SENSIBILIDAD E INTENTE DE NUEVO.');
        }
      }, 6000);
    } catch {
      setCalibrating(false);
      setCalibMsg('SIN ACCESO AL MICRÓFONO.');
    }
  };

  const spec = track?.spectrum ?? [];
  const svgW = 360;
  const svgH = 110;
  const xOf = (hz: number) => ((hz - 25) / (320 - 25)) * svgW;
  const yOf = (db: number) => ((0 - Math.max(-45, Math.min(0, db))) / 45) * (svgH - 22) + 8;
  const specPath =
    spec.length > 1
      ? spec.map((pt, i) => `${i === 0 ? 'M' : 'L'}${xOf(pt.hz).toFixed(1)},${yOf(pt.db).toFixed(1)}`).join(' ')
      : '';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/35">
      <div className="w-full max-w-md bg-[#F2F2EE] border-l-2 border-[#111111] h-full overflow-y-auto p-6 flex flex-col gap-6">
        <div className="flex items-center justify-between border-b border-[#111111] pb-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-[#666660]">
              CONSOLA TÉCNICA
            </div>
            <h3 className="text-lg font-bold tracking-tight text-[#111111]">
              Parámetros y Diagnóstico
            </h3>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1 border border-[#111111] bg-white hover:bg-[#111111] hover:text-white font-mono text-xs uppercase cursor-pointer"
          >
            Cerrar
          </button>
        </div>

        {/* 01. EQ & Balance */}
        <section className="bg-white border border-[#D2D2CA] p-4 space-y-4">
          <div className="font-mono text-[11px] uppercase tracking-wider font-semibold text-[#111111] border-b border-[#E5E5DF] pb-2">
            01 / Mezcla Acústica
          </div>

          <div className="space-y-2">
            <div className="flex justify-between font-mono text-xs">
              <span>PRESENCIA BOMBO</span>
              <span>{bombosVol === 0 ? '0% (KARAOKE)' : `${Math.round(bombosVol * 100)}%`}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.05}
              value={bombosVol}
              onChange={(e) => onBombosVolChange(Number(e.target.value))}
              className="w-full fader"
            />
          </div>

          <div className="space-y-2 pt-2">
            <div className="flex justify-between font-mono text-xs">
              <span>FILTRO SIKUS</span>
              <span>{sikusVol < 0.15 ? 'SOLO GRAVE' : `${Math.round(sikusVol * 100)}%`}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1.0}
              step={0.05}
              value={sikusVol}
              onChange={(e) => onSikusVolChange(Number(e.target.value))}
              className="w-full fader"
            />
          </div>
        </section>

        {/* 02. Microphone & Latency */}
        <section className="bg-white border border-[#D2D2CA] p-4 space-y-4">
          <div className="font-mono text-[11px] uppercase tracking-wider font-semibold text-[#111111] border-b border-[#E5E5DF] pb-2">
            02 / Entrada de Micrófono
          </div>

          <div className="space-y-2">
            <div className="flex justify-between font-mono text-xs">
              <span>GANANCIA DISPARO</span>
              <span>{sensitivity.toFixed(1)}X</span>
            </div>
            <input
              type="range"
              min={0.4}
              max={2.4}
              step={0.1}
              value={sensitivity}
              onChange={(e) => onSensitivityChange(Number(e.target.value))}
              className="w-full fader"
            />
            <div className="h-2 bg-[#EAEAE4] flex gap-0.5">
              <div
                className="h-full bg-[#111111] transition-all duration-75"
                style={{ width: `${Math.round(meter.lowRms * 50)}%` }}
              />
              <div
                className="h-full bg-[#E63B19] transition-all duration-75"
                style={{ width: `${Math.round(meter.attRms * 50)}%` }}
              />
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-[#E5E5DF]">
            <div className="flex justify-between font-mono text-xs">
              <span>LATENCIA (ΔL)</span>
              <span className="font-semibold text-[#E63B19]">{latencyMs} MS</span>
            </div>
            <input
              type="range"
              min={0}
              max={160}
              value={latencyMs}
              onChange={(e) => onLatencyChange(Number(e.target.value))}
              className="w-full fader"
            />
            <p className="font-mono text-[11px] text-[#666660]">{calibMsg}</p>
            <button
              disabled={calibrating}
              onClick={runCalibration}
              className="w-full py-2.5 bg-[#111111] hover:bg-[#E63B19] disabled:opacity-50 text-white font-mono text-xs uppercase tracking-wider transition cursor-pointer"
            >
              {calibrating ? 'MIDIENDO 8 PULSOS...' : 'MEDIR LATENCIA (8 PULSOS)'}
            </button>
          </div>
        </section>

        {/* 03. Spectrum & MATLAB V1 Benchmark */}
        {track && (
          <section className="bg-white border border-[#D2D2CA] p-4 space-y-3">
            <div className="font-mono text-[11px] uppercase tracking-wider font-semibold text-[#111111] border-b border-[#E5E5DF] pb-2">
              03 / Espectro Grave vs. MATLAB V1
            </div>

            {spec.length > 1 && (
              <div>
                <div className="flex justify-between font-mono text-[11px] text-[#666660] mb-1">
                  <span>PSD 25–320 HZ</span>
                  <span className="text-[#E63B19] font-semibold">PICO: {track.bomboResonanceHz} HZ</span>
                </div>
                <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-28 overflow-visible">
                  <rect
                    x={xOf(80)}
                    y={4}
                    width={xOf(150) - xOf(80)}
                    height={svgH - 18}
                    fill="#F2F2EE"
                    stroke="#A8A8A0"
                    strokeDasharray="3 3"
                  />
                  <path d={specPath} fill="none" stroke="#111111" strokeWidth="1.6" />
                  <line
                    x1={xOf(track.bomboResonanceHz)}
                    y1={4}
                    x2={xOf(track.bomboResonanceHz)}
                    y2={svgH - 14}
                    stroke="#E63B19"
                    strokeWidth="1.5"
                  />
                  {[50, 80, 150, 250].map((hz) => (
                    <text
                      key={hz}
                      x={xOf(hz)}
                      y={svgH - 2}
                      fontSize="9"
                      fontFamily="IBM Plex Mono, monospace"
                      fill="#666660"
                      textAnchor="middle"
                    >
                      {hz}
                    </text>
                  ))}
                </svg>
              </div>
            )}

            <div className="grid grid-cols-2 border-t border-[#E5E5DF] pt-2 font-mono text-xs">
              <div>
                <div className="text-[10px] text-[#666660]">MATLAB V1</div>
                <div className="font-semibold">{track.benchmarkV1.matlabV1Hits}</div>
              </div>
              <div>
                <div className="text-[10px] text-[#E63B19]">ICHUYIRI MIR V3</div>
                <div className="font-semibold">{track.benchmarkV1.ichuyiriV2Hits}</div>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
