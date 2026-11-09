import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IchuyiriAudioEngine } from './audio/engine';
import { HomeView } from './components/HomeView';
import { PracticeRoomView } from './components/PracticeRoomView';
import { SettingsDrawer } from './components/SettingsDrawer';
import type {
  CatalogItem,
  HitVerdict,
  LiveHitFeedback,
  MicMeterState,
  TrackMetadata,
  TrackSection,
} from './types';

type ActivePage = 'home' | 'practice';

export const App: React.FC = () => {
  const engine = useMemo(() => new IchuyiriAudioEngine(), []);

  const [page, setPage] = useState<ActivePage>('home');
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [customNames, setCustomNames] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem('ichuyiri_track_names') || '{}');
    } catch {
      return {};
    }
  });

  const [selectedId, setSelectedId] = useState<string>('');
  const [track, setTrack] = useState<TrackMetadata | null>(null);
  const [loadingTrack, setLoadingTrack] = useState<boolean>(true);
  const [uploading, setUploading] = useState<boolean>(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [sikusVol, setSikusVol] = useState(1.0);
  const [bombosVol, setBombosVol] = useState(1.0);
  const [guideOn, setGuideOn] = useState(false);
  const [activeLoopSec, setActiveLoopSec] = useState<TrackSection | null>(null);

  const [micActive, setMicActive] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [meter, setMeter] = useState<MicMeterState>({ rms: 0, lowRms: 0, attRms: 0 });
  const [sensitivity, setSensitivity] = useState(1.15);
  const [latencyMs, setLatencyMs] = useState(() => engine.getLatencyMs());
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [matchedIds, setMatchedIds] = useState<Set<number>>(new Set());
  const [recentHits, setRecentHits] = useState<LiveHitFeedback[]>([]);
  const matchedIdsRef = useRef<Set<number>>(new Set());
  const trackRef = useRef<TrackMetadata | null>(null);
  const hitCounterRef = useRef(1);

  useEffect(() => {
    trackRef.current = track;
  }, [track]);

  const getDisplayName = useCallback(
    (id: string, fallback: string) => customNames[id]?.trim() || fallback,
    [customNames],
  );

  const handleSaveCustomName = (id: string, newName: string) => {
    const next = { ...customNames, [id]: newName.trim() };
    if (!newName.trim()) delete next[id];
    setCustomNames(next);
    localStorage.setItem('ichuyiri_track_names', JSON.stringify(next));
  };

  const refreshCatalog = useCallback(async (selectTrackId?: string) => {
    try {
      const res = await fetch(`/tracks/catalog.json?t=${Date.now()}`);
      if (!res.ok) return;
      const items = (await res.json()) as CatalogItem[];
      setCatalog(items);
      if (selectTrackId) {
        setSelectedId(selectTrackId);
      } else if (items.length > 0) {
        setSelectedId((prev) => prev || items[0].id);
      }
    } catch (err) {
      console.error('Failed to load catalog:', err);
    }
  }, []);

  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;

    const load = async () => {
      setLoadingTrack(true);
      engine.pause();
      setIsPlaying(false);
      setActiveLoopSec(null);
      engine.setLoopRange(null);

      try {
        const res = await fetch(`/tracks/${selectedId}/track.json?t=${Date.now()}`);
        if (!res.ok) throw new Error('Track metadata not found');
        const meta = (await res.json()) as TrackMetadata;
        if (cancelled) return;

        setTrack(meta);
        matchedIdsRef.current = new Set();
        setMatchedIds(new Set());
        setRecentHits([]);
        setCurrentTime(0);

        const audioSrc = meta.audioUrl || meta.stems?.bombos || '';
        await engine.loadTrack(audioSrc, meta.bomboResonanceHz, meta.events);
        engine.setSikusVolume(sikusVol);
        engine.setBombosVolume(bombosVol);
        engine.setGuideVolume(guideOn ? 0.55 : 0);
        engine.setPlaybackRate(playbackRate);
      } catch (err) {
        console.error('Error loading track:', err);
      } finally {
        if (!cancelled) setLoadingTrack(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedId, engine]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setCurrentTime(engine.getSmoothTime());
      setIsPlaying(engine.isPlaying);
    }, 40);
    return () => window.clearInterval(id);
  }, [engine]);

  useEffect(() => {
    return engine.onMeter((m) => setMeter(m));
  }, [engine]);

  useEffect(() => {
    return engine.onOnset((onset) => {
      const curTrack = trackRef.current;
      if (!curTrack) return;

      const hitT = onset.trackTime;
      const captureWindowSec = 0.145;
      let bestEvent = null;
      let bestAbsDiff = Infinity;

      for (const ev of curTrack.events) {
        if (matchedIdsRef.current.has(ev.id)) continue;
        const diff = hitT - ev.t;
        if (diff < -captureWindowSec) break;
        if (Math.abs(diff) <= captureWindowSec && Math.abs(diff) < bestAbsDiff) {
          bestAbsDiff = Math.abs(diff);
          bestEvent = ev;
        }
      }

      let verdict: HitVerdict = 'unmatched';
      let offsetMs = 0;
      let dynamicOk = true;

      if (bestEvent) {
        offsetMs = Math.round((hitT - bestEvent.t) * 1000);
        const absMs = Math.abs(offsetMs);
        if (absMs <= 38) verdict = 'locked';
        else if (absMs <= 80) verdict = 'good';
        else if (offsetMs < 0) verdict = 'early';
        else verdict = 'late';

        dynamicOk = bestEvent.kind === 'acento' ? onset.weight >= 0.42 : true;

        const nextSet = new Set(matchedIdsRef.current);
        nextSet.add(bestEvent.id);
        matchedIdsRef.current = nextSet;
        setMatchedIds(nextSet);
      }

      const feedback: LiveHitFeedback = {
        id: hitCounterRef.current++,
        trackTime: hitT,
        createdAtPerf: performance.now(),
        offsetMs,
        verdict,
        weight: onset.weight,
        expectedKind: bestEvent?.kind,
        matchedEventId: bestEvent?.id,
        dynamicOk,
      };

      setRecentHits((prev) => [...prev.slice(-60), feedback]);
    });
  }, [engine]);

  const togglePlay = useCallback(async () => {
    if (engine.isPlaying) {
      engine.pause();
      setIsPlaying(false);
    } else {
      await engine.play();
      setIsPlaying(true);
    }
  }, [engine]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (page !== 'practice' || e.repeat) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if (e.code === 'Space') {
        e.preventDefault();
        void togglePlay();
      } else if (e.code === 'KeyJ' || e.code === 'KeyD') {
        e.preventDefault();
        engine.triggerManualHit(0.5);
      } else if (e.code === 'KeyF' || e.code === 'KeyK') {
        e.preventDefault();
        engine.triggerManualHit(0.88);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [page, engine, togglePlay]);

  const stats = useMemo(() => {
    const scored = recentHits.filter((h) => h.verdict !== 'unmatched');
    if (scored.length === 0) {
      return { accuracyPct: 0, meanOffsetMs: 0, accentPct: 100, streak: 0, totalScored: 0 };
    }
    const onTime = scored.filter((h) => h.verdict === 'locked' || h.verdict === 'good').length;
    const accuracyPct = Math.round((onTime / scored.length) * 100);
    const meanOffsetMs = Math.round(scored.reduce((acc, h) => acc + h.offsetMs, 0) / scored.length);

    const accents = scored.filter((h) => h.expectedKind === 'acento');
    const accentOk = accents.filter((h) => h.dynamicOk).length;
    const accentPct = accents.length > 0 ? Math.round((accentOk / accents.length) * 100) : 100;

    let streak = 0;
    for (let i = scored.length - 1; i >= 0; i--) {
      if (scored[i].verdict === 'locked' || scored[i].verdict === 'good') streak++;
      else break;
    }

    return { accuracyPct, meanOffsetMs, accentPct, streak, totalScored: scored.length };
  }, [recentHits]);

  const openTrackInPractice = (id: string) => {
    setSelectedId(id);
    setPage('practice');
    window.scrollTo({ top: 0 });
  };

  const handleBackToGallery = () => {
    engine.pause();
    setIsPlaying(false);
    setPage('home');
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('title', file.name.replace(/\.[^.]+$/, ''));
      const res = await fetch('/api/analyze', { method: 'POST', body: form });
      if (!res.ok) throw new Error('Backend MIR no disponible');
      const created = (await res.json()) as TrackMetadata;
      await refreshCatalog(created.id);
      setPage('practice');
    } catch {
      alert('Servidor MIR no disponible en puerto 8420.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div className="min-h-screen bg-[#F2F2EE] text-[#111111] flex flex-col">
      {/* Crisp 48px Architectural Top Strip */}
      <header className="h-12 border-b border-[#111111] bg-[#F2F2EE] sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 h-full flex items-center justify-between font-mono text-xs">
          <div className="flex items-center h-full divide-x divide-[#D2D2CA]">
            <button
              onClick={handleBackToGallery}
              className="pr-4 h-full flex items-center gap-2 font-bold tracking-tight text-sm text-[#111111] cursor-pointer"
            >
              <span className="w-2.5 h-2.5 bg-[#E63B19] inline-block" />
              <span>ICHUYIRI</span>
            </button>

            <button
              onClick={handleBackToGallery}
              className={`px-4 h-full uppercase tracking-wider transition cursor-pointer ${
                page === 'home' ? 'bg-white font-semibold text-[#111111]' : 'text-[#666660] hover:text-[#111111]'
              }`}
            >
              01 Archivo
            </button>

            <button
              onClick={() => setPage('practice')}
              className={`px-4 h-full uppercase tracking-wider transition cursor-pointer ${
                page === 'practice' ? 'bg-white font-semibold text-[#111111]' : 'text-[#666660] hover:text-[#111111]'
              }`}
            >
              02 Estudio
            </button>
          </div>

          <div className="flex items-center h-full divide-x divide-[#D2D2CA]">
            <button
              onClick={() => setDrawerOpen(true)}
              className="px-3 h-full text-[#666660] hover:text-[#111111] cursor-pointer hidden sm:flex items-center"
            >
              ΔL {latencyMs}MS
            </button>
            <div className="pl-3 h-full flex items-center gap-2">
              <span className={`w-2 h-2 ${micActive ? 'bg-[#166534]' : 'bg-[#A8A8A0]'}`} />
              <span className="text-[#666660] hidden sm:inline">{micActive ? 'MIC ON' : 'MIC OFF'}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {page === 'home' ? (
          <HomeView
            catalog={catalog}
            selectedId={selectedId}
            getDisplayName={getDisplayName}
            onSaveCustomName={handleSaveCustomName}
            onOpenTrack={openTrackInPractice}
            onUploadFile={handleUploadFile}
            uploading={uploading}
            onOpenSettings={() => setDrawerOpen(true)}
          />
        ) : (
          <PracticeRoomView
            engine={engine}
            catalog={catalog}
            track={track}
            loadingTrack={loadingTrack}
            displayName={track ? getDisplayName(track.id, track.title) : ''}
            onBackToGallery={handleBackToGallery}
            onSelectTrackId={(id) => setSelectedId(id)}
            getDisplayName={getDisplayName}
            isPlaying={isPlaying}
            onTogglePlay={() => void togglePlay()}
            currentTime={currentTime}
            onSeek={(sec) => {
              engine.seek(sec);
              setCurrentTime(sec);
            }}
            onResetSession={() => {
              const startSec = activeLoopSec ? activeLoopSec.start : 0;
              engine.seek(startSec);
              matchedIdsRef.current = new Set();
              setMatchedIds(new Set());
              setRecentHits([]);
              setCurrentTime(startSec);
            }}
            playbackRate={playbackRate}
            onPlaybackRateChange={(r) => {
              setPlaybackRate(r);
              engine.setPlaybackRate(r);
            }}
            bombosVol={bombosVol}
            onToggleKaraoke={() => {
              const next = bombosVol > 0.05 ? 0 : 1.0;
              setBombosVol(next);
              engine.setBombosVolume(next);
            }}
            guideOn={guideOn}
            onToggleGuide={() => {
              const next = !guideOn;
              setGuideOn(next);
              engine.setGuideVolume(next ? 0.55 : 0);
            }}
            activeLoopSec={activeLoopSec}
            onToggleSectionLoop={(sec) => {
              if (activeLoopSec?.id === sec.id) {
                setActiveLoopSec(null);
                engine.setLoopRange(null);
              } else {
                setActiveLoopSec(sec);
                engine.setLoopRange({ start: sec.start, end: sec.end });
                engine.seek(sec.start);
                setCurrentTime(sec.start);
              }
            }}
            micActive={micActive}
            micError={micError}
            onToggleMic={async () => {
              setMicError(null);
              if (micActive) {
                engine.disableMicrophone();
                setMicActive(false);
              } else {
                try {
                  await engine.enableMicrophone();
                  setMicActive(true);
                } catch {
                  setMicError('SIN ACCESO AL MICRÓFONO.');
                }
              }
            }}
            onOpenSettings={() => setDrawerOpen(true)}
            matchedIds={matchedIds}
            recentHits={recentHits}
            stats={stats}
          />
        )}
      </main>

      <SettingsDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        engine={engine}
        track={track}
        bombosVol={bombosVol}
        onBombosVolChange={(v) => {
          setBombosVol(v);
          engine.setBombosVolume(v);
        }}
        sikusVol={sikusVol}
        onSikusVolChange={(v) => {
          setSikusVol(v);
          engine.setSikusVolume(v);
        }}
        sensitivity={sensitivity}
        onSensitivityChange={(v) => {
          setSensitivity(v);
          engine.setSensitivity(v);
        }}
        latencyMs={latencyMs}
        onLatencyChange={(ms) => {
          setLatencyMs(ms);
          engine.setLatencyMs(ms);
        }}
        meter={meter}
      />
    </div>
  );
};

export default App;
