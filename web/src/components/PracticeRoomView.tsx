import React from 'react';
import type { IchuyiriAudioEngine } from '../audio/engine';
import type {
  CatalogItem,
  LiveHitFeedback,
  TrackMetadata,
  TrackSection,
} from '../types';
import { ScoreTimeline } from './ScoreTimeline';

interface PracticeRoomViewProps {
  engine: IchuyiriAudioEngine;
  catalog: CatalogItem[];
  track: TrackMetadata | null;
  loadingTrack: boolean;
  displayName: string;
  onBackToGallery: () => void;
  onSelectTrackId: (id: string) => void;
  getDisplayName: (id: string, fallback: string) => string;

  isPlaying: boolean;
  onTogglePlay: () => void;
  currentTime: number;
  onSeek: (sec: number) => void;
  onResetSession: () => void;

  playbackRate: number;
  onPlaybackRateChange: (r: number) => void;
  bombosVol: number;
  onToggleKaraoke: () => void;
  guideOn: boolean;
  onToggleGuide: () => void;

  activeLoopSec: TrackSection | null;
  onToggleSectionLoop: (sec: TrackSection) => void;

  micActive: boolean;
  micError: string | null;
  onToggleMic: () => void;
  onOpenSettings: () => void;

  matchedIds: Set<number>;
  recentHits: LiveHitFeedback[];
  stats: {
    accuracyPct: number;
    meanOffsetMs: number;
    accentPct: number;
    streak: number;
    totalScored: number;
  };
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const rem = (s % 60).toString().padStart(2, '0');
  return `${m}:${rem}`;
}

export const PracticeRoomView: React.FC<PracticeRoomViewProps> = ({
  engine,
  catalog,
  track,
  loadingTrack,
  displayName,
  onBackToGallery,
  onSelectTrackId,
  getDisplayName,
  isPlaying,
  onTogglePlay,
  currentTime,
  onSeek,
  onResetSession,
  playbackRate,
  onPlaybackRateChange,
  bombosVol,
  onToggleKaraoke,
  guideOn,
  onToggleGuide,
  activeLoopSec,
  onToggleSectionLoop,
  micActive,
  micError,
  onToggleMic,
  onOpenSettings,
  matchedIds,
  recentHits,
  stats,
}) => {
  return (
    <div className="flex flex-col">
      {/* Track & Hardware Mode Strip */}
      <div className="max-w-6xl w-full mx-auto px-4 sm:px-8 py-5 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-3 font-mono text-xs text-[#666660]">
            <button
              onClick={onBackToGallery}
              className="hover:text-[#111111] uppercase tracking-wider cursor-pointer"
            >
              ← Índice
            </button>
            <span>/</span>
            <select
              value={track?.id || ''}
              onChange={(e) => onSelectTrackId(e.target.value)}
              className="bg-transparent text-[#111111] font-medium outline-none cursor-pointer"
            >
              {catalog.map((c, idx) => (
                <option key={c.id} value={c.id}>
                  {String(idx + 1).padStart(2, '0')} — {getDisplayName(c.id, c.title)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-baseline gap-4">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-[-0.03em] text-[#111111]">
              {loadingTrack ? 'Cargando...' : displayName}
            </h1>
            {track && (
              <span className="font-mono text-xs text-[#666660]">
                {Math.round(track.bpm)} BPM · {track.bomboResonanceHz} HZ · {track.counts.total} GOLPES
              </span>
            )}
          </div>
        </div>

        {/* Mechanical Toggle Switches */}
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <button
            onClick={onToggleGuide}
            className={`px-3 py-2 border uppercase tracking-wider transition cursor-pointer ${
              guideOn
                ? 'border-[#111111] bg-[#111111] text-white'
                : 'border-[#D2D2CA] bg-white text-[#666660] hover:border-[#111111] hover:text-[#111111]'
            }`}
          >
            Guía {guideOn ? 'ON' : 'OFF'}
          </button>

          <button
            onClick={onOpenSettings}
            className="px-3 py-2 border border-[#D2D2CA] hover:border-[#111111] bg-white text-[#111111] uppercase tracking-wider transition cursor-pointer"
          >
            Parámetros
          </button>

          <button
            onClick={onToggleMic}
            className={`inline-flex items-center gap-2 px-4 py-2 border uppercase tracking-wider font-semibold transition cursor-pointer ${
              micActive
                ? 'border-[#E63B19] bg-[#E63B19] text-white'
                : 'border-[#111111] bg-[#111111] text-white hover:bg-[#E63B19] hover:border-[#E63B19]'
            }`}
          >
            <span
              className={`w-2 h-2 inline-block ${
                micActive ? 'bg-white animate-pulse' : 'bg-[#E63B19]'
              }`}
            />
            <span>{micActive ? 'MIC ACTIVO' : 'ARMAR MIC'}</span>
          </button>
        </div>
      </div>

      {micError && (
        <div className="max-w-6xl w-full mx-auto px-4 sm:px-8 pb-3">
          <div className="border border-[#E63B19] bg-white px-3 py-2 font-mono text-xs text-[#E63B19]">
            ERROR: {micError}
          </div>
        </div>
      )}

      {/* Full-Width Engraved Percussion Score */}
      <div className="max-w-6xl w-full mx-auto px-4 sm:px-8">
        <ScoreTimeline
          engine={engine}
          events={track?.events ?? []}
          matchedIds={matchedIds}
          recentHits={recentHits}
        />
      </div>

      {/* Tape Scrubber, Phrase Matrix & Hardware Console */}
      <div className="max-w-6xl w-full mx-auto px-4 sm:px-8 pb-10 space-y-6 pt-5">
        {track && (
          <div className="space-y-3">
            {/* Linear Monochrome Waveform Bar */}
            <div
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                onSeek(ratio * track.duration);
              }}
              className="h-10 bg-white border border-[#D2D2CA] px-1.5 flex items-end gap-px cursor-pointer"
              title="Saltar a posición"
            >
              {track.waveform.map((pk, idx) => {
                const tBin = (idx / track.waveform.length) * track.duration;
                const passed = tBin <= currentTime;
                const inLoop =
                  activeLoopSec && tBin >= activeLoopSec.start && tBin <= activeLoopSec.end;
                return (
                  <div
                    key={idx}
                    className={`flex-1 ${
                      inLoop
                        ? passed
                          ? 'bg-[#E63B19]'
                          : 'bg-[#E63B19]/35'
                        : passed
                          ? 'bg-[#111111]'
                          : 'bg-[#D6D6CE]'
                    }`}
                    style={{ height: `${Math.max(12, Math.round(pk * 90))}%` }}
                  />
                );
              })}
            </div>

            {/* Structural Section Matrix */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1 font-mono text-[11px]">
                <span className="text-[#666660] uppercase mr-2">Loop:</span>
                {track.sections.map((sec) => {
                  const active = activeLoopSec?.id === sec.id;
                  return (
                    <button
                      key={sec.id}
                      onClick={() => onToggleSectionLoop(sec)}
                      className={`px-2.5 py-1 border uppercase transition cursor-pointer ${
                        active
                          ? 'border-[#E63B19] bg-[#E63B19] text-white'
                          : 'border-[#D2D2CA] bg-white text-[#666660] hover:border-[#111111] hover:text-[#111111]'
                      }`}
                    >
                      {sec.name}
                    </button>
                  );
                })}
              </div>

              <div className="font-mono text-xs text-[#666660]">
                <span className="text-[#111111] font-semibold">{formatTime(currentTime)}</span> /{' '}
                {formatTime(track.duration)}
              </div>
            </div>
          </div>
        )}

        {/* Structural 1px-Divided Hardware Console */}
        <div className="grid grid-cols-1 lg:grid-cols-12 border border-[#111111] bg-white divide-y lg:divide-y-0 lg:divide-x divide-[#111111]">
          {/* Cell 1: Transport Keys */}
          <div className="lg:col-span-4 p-4 flex items-center gap-2 font-mono text-xs">
            <button
              onClick={() => onSeek(currentTime - 5)}
              className="px-3 py-2.5 border border-[#D2D2CA] hover:border-[#111111] text-[#111111] cursor-pointer"
            >
              -5S
            </button>

            <button
              disabled={loadingTrack}
              onClick={onTogglePlay}
              className={`flex-1 py-2.5 px-4 font-semibold uppercase tracking-wider transition cursor-pointer ${
                isPlaying
                  ? 'bg-[#E63B19] text-white'
                  : 'bg-[#111111] hover:bg-[#E63B19] text-white'
              }`}
            >
              {isPlaying ? 'PAUSAR [ESPACIO]' : 'REPRODUCIR'}
            </button>

            <button
              onClick={() => onSeek(currentTime + 5)}
              className="px-3 py-2.5 border border-[#D2D2CA] hover:border-[#111111] text-[#111111] cursor-pointer"
            >
              +5S
            </button>

            <button
              onClick={onResetSession}
              className="px-3 py-2.5 border border-[#D2D2CA] hover:border-[#111111] text-[#666660] hover:text-[#111111] cursor-pointer"
              title="Reiniciar"
            >
              00
            </button>
          </div>

          {/* Cell 2: Speed & Karaoke Switches */}
          <div className="lg:col-span-4 p-4 flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
            <div className="flex border border-[#D2D2CA] divide-x divide-[#D2D2CA]">
              {[0.65, 0.8, 0.9, 1.0].map((rate) => {
                const active = Math.abs(playbackRate - rate) < 0.03;
                return (
                  <button
                    key={rate}
                    onClick={() => onPlaybackRateChange(rate)}
                    className={`px-2.5 py-2 transition cursor-pointer ${
                      active
                        ? 'bg-[#111111] text-white font-semibold'
                        : 'bg-white text-[#666660] hover:text-[#111111]'
                    }`}
                  >
                    {Math.round(rate * 100)}%
                  </button>
                );
              })}
            </div>

            <button
              onClick={onToggleKaraoke}
              className={`px-3 py-2 border uppercase transition cursor-pointer ${
                bombosVol === 0
                  ? 'border-[#111111] bg-[#111111] text-white'
                  : 'border-[#D2D2CA] text-[#111111] hover:border-[#111111]'
              }`}
            >
              {bombosVol === 0 ? 'BOMBO: MUDO' : 'SILENCIAR BOMBO'}
            </button>
          </div>

          {/* Cell 3: Live Precision Readout */}
          <div className="lg:col-span-4 grid grid-cols-3 divide-x divide-[#D2D2CA] font-mono">
            <div className="p-3.5 flex flex-col justify-between">
              <span className="text-[10px] uppercase text-[#666660]">Empaste</span>
              <span className="text-lg font-semibold text-[#111111] mt-1">
                {stats.totalScored > 0 ? `${stats.accuracyPct}%` : '—'}
              </span>
            </div>
            <div className="p-3.5 flex flex-col justify-between">
              <span className="text-[10px] uppercase text-[#666660]">Desvío</span>
              <span className="text-lg font-semibold text-[#111111] mt-1">
                {stats.totalScored > 0
                  ? `${stats.meanOffsetMs > 0 ? '+' : ''}${stats.meanOffsetMs}ms`
                  : '0ms'}
              </span>
            </div>
            <div className="p-3.5 flex flex-col justify-between">
              <span className="text-[10px] uppercase text-[#666660]">Acentos</span>
              <span className="text-lg font-semibold text-[#111111] mt-1">
                {stats.totalScored > 0 ? `${stats.accentPct}%` : '—'}
              </span>
            </div>
          </div>
        </div>

        <div className="font-mono text-[11px] text-[#666660] flex flex-wrap justify-between gap-2">
          <span>NOTA: Use audífonos al activar el micrófono para evitar realimentación acústica.</span>
          <span>TECLAS DE PRUEBA: [J] PULSO · [F] ACENTO · [ESPACIO] PLAY</span>
        </div>
      </div>
    </div>
  );
};
