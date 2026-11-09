import React, { useState } from 'react';
import type { CatalogItem } from '../types';

interface HomeViewProps {
  catalog: CatalogItem[];
  selectedId: string;
  getDisplayName: (id: string, fallback: string) => string;
  onSaveCustomName: (id: string, newName: string) => void;
  onOpenTrack: (id: string) => void;
  onUploadFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  uploading: boolean;
  onOpenSettings: () => void;
}

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

export const HomeView: React.FC<HomeViewProps> = ({
  catalog,
  selectedId,
  getDisplayName,
  onSaveCustomName,
  onOpenTrack,
  onUploadFile,
  uploading,
  onOpenSettings,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8 space-y-8">
      {/* Stark Technical Specification Header (No marketing fluff) */}
      <div className="border-y-2 border-[#111111] py-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
        <div className="lg:col-span-7 space-y-2">
          <div className="font-mono text-[11px] uppercase tracking-widest text-[#666660]">
            SISTEMA DE PRÁCTICA RÍTMICA · SIKURI DE VARIOS BOMBOS
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-[-0.03em] text-[#111111]">
            Índice de Grabaciones de Tropa
          </h1>
        </div>

        <div className="lg:col-span-5 flex flex-wrap items-center lg:justify-end gap-2">
          <button
            onClick={onOpenSettings}
            className="px-3.5 py-2 border border-[#111111] bg-transparent hover:bg-[#111111] hover:text-white font-mono text-xs uppercase tracking-wider transition cursor-pointer"
          >
            Calibrar Mic
          </button>

          <label className="px-4 py-2 border border-[#111111] bg-[#111111] hover:bg-[#E63B19] hover:border-[#E63B19] text-white font-mono text-xs uppercase tracking-wider transition cursor-pointer">
            {uploading ? 'PROCESANDO...' : '+ IMPORTAR AUDIO'}
            <input
              type="file"
              accept="audio/*,video/mp4,video/mpeg"
              className="hidden"
              onChange={onUploadFile}
            />
          </label>
        </div>
      </div>

      {/* Compact Inline Engraved Legend Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 border border-[#D2D2CA] bg-white divide-y sm:divide-y-0 sm:divide-x divide-[#D2D2CA] text-xs">
        <div className="p-3.5 flex items-center gap-3">
          <span className="font-mono text-base font-bold leading-none">♩</span>
          <div>
            <div className="font-semibold">Pulso</div>
            <div className="text-[11px] text-[#666660]">Base caminada</div>
          </div>
        </div>
        <div className="p-3.5 flex items-center gap-3">
          <span className="font-mono text-base font-bold leading-none">&gt;♩</span>
          <div>
            <div className="font-semibold">Acento</div>
            <div className="text-[11px] text-[#666660]">Golpe de peso</div>
          </div>
        </div>
        <div className="p-3.5 flex items-center gap-3">
          <span className="font-mono text-base font-bold leading-none">♬</span>
          <div>
            <div className="font-semibold">Repique</div>
            <div className="text-[11px] text-[#666660]">Subdivisión rápida</div>
          </div>
        </div>
        <div className="p-3.5 flex items-center gap-3">
          <span className="font-mono text-sm font-bold leading-none tracking-tighter text-[#E63B19]">|┃</span>
          <div>
            <div className="font-semibold">Corte</div>
            <div className="text-[11px] text-[#666660]">Cierre de frase</div>
          </div>
        </div>
      </div>

      {/* Tabular Tracklist (Tape / Vinyl Pressing Sheet Layout) */}
      <div className="border-t border-[#111111]">
        {/* Table Column Headers */}
        <div className="hidden md:grid md:grid-cols-12 gap-4 py-2.5 px-3 border-b border-[#111111] font-mono text-[11px] uppercase tracking-wider text-[#666660]">
          <div className="col-span-1">N°</div>
          <div className="col-span-4">Grabación</div>
          <div className="col-span-2 text-right">Tempo</div>
          <div className="col-span-2 text-right">Cuero</div>
          <div className="col-span-2 text-right">Golpes (P/A/R)</div>
          <div className="col-span-1 text-right">Dur.</div>
        </div>

        <div className="divide-y divide-[#D2D2CA] border-b border-[#111111]">
          {catalog.map((item, idx) => {
            const name = getDisplayName(item.id, item.title);
            const isEditing = editingId === item.id;
            const isSelected = item.id === selectedId;

            return (
              <div
                key={item.id}
                onClick={() => !isEditing && onOpenTrack(item.id)}
                className={`group grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 py-3.5 px-3 items-center transition cursor-pointer relative ${
                  isSelected ? 'bg-white' : 'hover:bg-white'
                }`}
              >
                {/* Left Signal Bar on Hover / Active */}
                <span
                  className={`absolute left-0 top-0 bottom-0 w-[3px] transition-opacity ${
                    isSelected ? 'bg-[#E63B19] opacity-100' : 'bg-[#111111] opacity-0 group-hover:opacity-100'
                  }`}
                />

                <div className="md:col-span-1 font-mono text-xs text-[#666660] flex items-center justify-between md:justify-start">
                  <span>{String(idx + 1).padStart(2, '0')}</span>
                  <span className="md:hidden font-mono text-xs text-[#111111]">
                    {Math.round(item.bpm)} BPM · {formatDuration(item.duration)}
                  </span>
                </div>

                <div className="md:col-span-4 flex items-center gap-2 min-w-0">
                  {isEditing ? (
                    <div className="flex items-center gap-1.5 w-full" onClick={(e) => e.stopPropagation()}>
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            onSaveCustomName(item.id, draft);
                            setEditingId(null);
                          }
                        }}
                        className="w-full bg-[#F2F2EE] border border-[#111111] px-2 py-0.5 text-sm outline-none"
                      />
                      <button
                        onClick={() => {
                          onSaveCustomName(item.id, draft);
                          setEditingId(null);
                        }}
                        className="px-2 py-0.5 bg-[#111111] text-white font-mono text-xs cursor-pointer"
                      >
                        OK
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="font-semibold text-sm text-[#111111] truncate group-hover:underline">
                        {name}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(item.id);
                          setDraft(name);
                        }}
                        className="opacity-0 group-hover:opacity-100 font-mono text-[10px] uppercase px-1.5 py-0.5 border border-[#D2D2CA] hover:border-[#111111] text-[#666660] hover:text-[#111111] shrink-0"
                      >
                        Editar
                      </button>
                    </>
                  )}
                </div>

                <div className="hidden md:block md:col-span-2 text-right font-mono text-xs">
                  {item.bpm.toFixed(0)} BPM
                </div>

                <div className="hidden md:block md:col-span-2 text-right font-mono text-xs text-[#666660]">
                  {item.bomboResonanceHz} Hz
                </div>

                <div className="hidden md:block md:col-span-2 text-right font-mono text-xs text-[#666660]">
                  {item.counts.pulso}/{item.counts.acento}/{item.counts.repique}
                </div>

                <div className="hidden md:block md:col-span-1 text-right font-mono text-xs font-medium">
                  {formatDuration(item.duration)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
