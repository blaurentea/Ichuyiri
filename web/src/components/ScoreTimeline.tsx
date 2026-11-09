import React, { useEffect, useRef } from 'react';
import type { IchuyiriAudioEngine } from '../audio/engine';
import type { BomboEvent, LiveHitFeedback } from '../types';

interface ScoreTimelineProps {
  engine: IchuyiriAudioEngine;
  events: BomboEvent[];
  matchedIds: Set<number>;
  recentHits: LiveHitFeedback[];
  lookAheadSec?: number;
}

export const ScoreTimeline: React.FC<ScoreTimelineProps> = ({
  engine,
  events,
  matchedIds,
  recentHits,
  lookAheadSec = 2.8,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const eventsRef = useRef(events);
  const matchedRef = useRef(matchedIds);
  const hitsRef = useRef(recentHits);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  useEffect(() => {
    matchedRef.current = matchedIds;
  }, [matchedIds]);

  useEffect(() => {
    hitsRef.current = recentHits;
  }, [recentHits]);

  useEffect(() => {
    let rafId = 0;

    const render = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
          canvas.width = Math.round(rect.width * dpr);
          canvas.height = Math.round(rect.height * dpr);
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.save();
          ctx.scale(dpr, dpr);
          const w = rect.width;
          const h = rect.height;

          const tNow = engine.getSmoothTime();
          const pastSec = 0.7;
          const marginLeft = 52;
          const playheadX = Math.max(130, Math.min(210, w * 0.22));
          const pxPerSec = (w - playheadX - 24) / lookAheadSec;

          const rulerH = 26;
          const yStaff = h * 0.54;
          const yMic = h * 0.84;

          // Pure White Score Surface
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, w, h);

          // Top Technical Timecode Ruler
          ctx.fillStyle = '#F2F2EE';
          ctx.fillRect(0, 0, w, rulerH);
          ctx.strokeStyle = '#D2D2CA';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, rulerH);
          ctx.lineTo(w, rulerH);
          ctx.stroke();

          // Grid Barlines
          const firstTick = Math.floor((tNow - pastSec) * 2) / 2;
          ctx.font = '500 10px "IBM Plex Mono", monospace';
          ctx.textAlign = 'center';

          for (let gt = firstTick; gt <= tNow + lookAheadSec + 0.2; gt += 0.5) {
            if (gt < 0) continue;
            const gx = playheadX + (gt - tNow) * pxPerSec;
            if (gx < marginLeft || gx > w) continue;
            const isWhole = Math.abs(gt - Math.round(gt)) < 0.01;

            ctx.strokeStyle = isWhole ? '#E2E2DC' : '#F2F2EE';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(gx, rulerH);
            ctx.lineTo(gx, h);
            ctx.stroke();

            // Ruler tick
            ctx.strokeStyle = '#A8A8A0';
            ctx.beginPath();
            ctx.moveTo(gx, isWhole ? rulerH - 6 : rulerH - 3);
            ctx.lineTo(gx, rulerH);
            ctx.stroke();

            if (isWhole) {
              const secInt = Math.round(gt);
              const mm = Math.floor(secInt / 60);
              const ss = (secInt % 60).toString().padStart(2, '0');
              ctx.fillStyle = '#666660';
              ctx.fillText(`${mm}:${ss}`, gx, 15);
            }
          }

          // Main Percussion Staff Line (Single-line Bombo Staff)
          ctx.strokeStyle = '#999992';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(marginLeft, yStaff);
          ctx.lineTo(w, yStaff);
          ctx.stroke();

          // Lower Live Mic Trace Baseline
          ctx.strokeStyle = '#DCDCD4';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(marginLeft, yMic);
          ctx.lineTo(w, yMic);
          ctx.stroke();

          // Fixed Left Clef Margin Column (Masks scrolling behind clef)
          ctx.fillStyle = '#F8F8F5';
          ctx.fillRect(0, rulerH + 1, marginLeft, h - rulerH - 1);
          ctx.strokeStyle = '#D2D2CA';
          ctx.beginPath();
          ctx.moveTo(marginLeft, rulerH);
          ctx.lineTo(marginLeft, h);
          ctx.stroke();

          // Engraved Neutral Percussion Clef (Two bold vertical bars)
          ctx.fillStyle = '#111111';
          ctx.fillRect(20, yStaff - 12, 3, 24);
          ctx.fillRect(27, yStaff - 12, 3, 24);

          ctx.fillStyle = '#666660';
          ctx.font = '600 9px "IBM Plex Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText('MIC', marginLeft / 2, yMic + 3);

          // Clip scrollable score area to right of marginLeft
          ctx.save();
          ctx.beginPath();
          ctx.rect(marginLeft + 1, rulerH + 1, w - marginLeft - 1, h - rulerH - 1);
          ctx.clip();

          // Collect visible events
          const evs = eventsRef.current;
          const visible: BomboEvent[] = [];
          for (let i = 0; i < evs.length; i++) {
            const ev = evs[i];
            if (ev.t < tNow - pastSec - 0.1) continue;
            if (ev.t > tNow + lookAheadSec + 0.2) break;
            visible.push(ev);
          }

          const stemHeightFor = (ev: BomboEvent) =>
            ev.kind === 'acento' ? 42 : ev.kind === 'repique' ? 32 : 36;

          const stemXFor = (ev: BomboEvent, xPos: number) => {
            const rx = ev.kind === 'acento' ? 7.2 : ev.kind === 'repique' ? 5.6 : 6.4;
            return xPos + rx - 1.1;
          };

          // Group consecutive rapid repiques for clean eighth/sixteenth beaming
          const beamedIds = new Set<number>();
          let idx = 0;
          while (idx < visible.length) {
            if (visible[idx].kind === 'repique') {
              let endIdx = idx;
              while (
                endIdx + 1 < visible.length &&
                visible[endIdx + 1].kind === 'repique' &&
                visible[endIdx + 1].t - visible[endIdx].t <= 0.30
              ) {
                endIdx++;
              }
              if (endIdx > idx) {
                const xStart = stemXFor(visible[idx], playheadX + (visible[idx].t - tNow) * pxPerSec);
                const xEnd = stemXFor(visible[endIdx], playheadX + (visible[endIdx].t - tNow) * pxPerSec);
                const beamTopY = yStaff - 32;

                ctx.fillStyle = '#111111';
                ctx.fillRect(xStart - 0.8, beamTopY, xEnd - xStart + 1.6, 4.5);

                for (let k = idx; k <= endIdx; k++) {
                  beamedIds.add(visible[k].id);
                }
              }
              idx = endIdx + 1;
            } else {
              idx++;
            }
          }

          // Draw Engraved Percussion Notes
          for (const ev of visible) {
            const x = playheadX + (ev.t - tNow) * pxPerSec;
            const isPast = ev.t < tNow - 0.03;
            const isMatched = matchedRef.current.has(ev.id);

            ctx.save();
            ctx.globalAlpha = isPast ? 0.28 : 1.0;

            const stemH = beamedIds.has(ev.id) ? 32 : stemHeightFor(ev);
            const rx = ev.kind === 'acento' ? 7.2 : ev.kind === 'repique' ? 5.6 : 6.4;
            const ry = ev.kind === 'acento' ? 5.2 : ev.kind === 'repique' ? 4.1 : 4.6;

            // 1. Classic Tilted Solid Black Notehead
            ctx.fillStyle = '#111111';
            ctx.save();
            ctx.translate(x, yStaff);
            ctx.rotate(-0.36);
            ctx.beginPath();
            ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            // 2. Crisp Upward Stem
            const sx = x + rx - 1.1;
            ctx.strokeStyle = '#111111';
            ctx.lineWidth = ev.kind === 'acento' ? 2.0 : 1.5;
            ctx.beginPath();
            ctx.moveTo(sx, yStaff);
            ctx.lineTo(sx, yStaff - stemH);
            ctx.stroke();

            // Single flag if isolated repique (not beamed)
            if (ev.kind === 'repique' && !beamedIds.has(ev.id)) {
              ctx.beginPath();
              ctx.moveTo(sx, yStaff - stemH);
              ctx.quadraticCurveTo(sx + 8, yStaff - stemH + 6, sx + 6, yStaff - stemH + 15);
              ctx.stroke();
            }

            // 3. Engraved '>' Accent Wedge above Stem for Acentos
            if (ev.kind === 'acento') {
              const ay = yStaff - stemH - 9;
              ctx.strokeStyle = '#111111';
              ctx.lineWidth = 1.8;
              ctx.beginPath();
              ctx.moveTo(x - 5, ay - 3.5);
              ctx.lineTo(x + 6, ay);
              ctx.lineTo(x - 5, ay + 3.5);
              ctx.stroke();
            }

            // 4. Classical Engraved Double Barline (|┃) for Sikuri Cortes
            if (ev.isCorte) {
              const bx = x + 18;
              ctx.strokeStyle = '#111111';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(bx, yStaff - 28);
              ctx.lineTo(bx, yStaff + 28);
              ctx.stroke();

              ctx.fillStyle = '#111111';
              ctx.fillRect(bx + 3.5, yStaff - 28, 3.5, 56);

              ctx.fillStyle = '#E63B19';
              ctx.font = '600 9px "IBM Plex Mono", monospace';
              ctx.textAlign = 'left';
              ctx.fillText('CORTE', bx - 2, yStaff - 34);
            }

            // Small matched dot below notehead
            if (isMatched) {
              ctx.globalAlpha = 1.0;
              ctx.fillStyle = '#166534';
              ctx.fillRect(x - 2, yStaff + 11, 4, 4);
            }

            ctx.restore();
          }

          // Draw Live Microphone Impulse Ticks along Lower Trace
          const hits = hitsRef.current;
          for (let i = Math.max(0, hits.length - 30); i < hits.length; i++) {
            const hit = hits[i];
            if (hit.trackTime < tNow - pastSec - 0.1 || hit.trackTime > tNow + 0.5) continue;
            const hx = playheadX + (hit.trackTime - tNow) * pxPerSec;
            const tickH = 8 + hit.weight * 14;

            ctx.strokeStyle =
              hit.verdict === 'locked' || hit.verdict === 'good'
                ? '#166534'
                : hit.verdict === 'unmatched'
                  ? '#888880'
                  : '#E63B19';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(hx, yMic - tickH);
            ctx.lineTo(hx, yMic + 4);
            ctx.stroke();
          }

          ctx.restore(); // End score clip

          // Signal-Vermilion Hardware Playhead Needle
          ctx.strokeStyle = '#E63B19';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(playheadX, rulerH);
          ctx.lineTo(playheadX, h);
          ctx.stroke();

          // Sharp Triangle Pointer at Ruler Edge
          ctx.fillStyle = '#E63B19';
          ctx.beginPath();
          ctx.moveTo(playheadX - 5, rulerH);
          ctx.lineTo(playheadX + 5, rulerH);
          ctx.lineTo(playheadX, rulerH + 7);
          ctx.closePath();
          ctx.fill();

          // Minimal Monospace Timing Readout in Top Right of Ruler
          if (hits.length > 0) {
            const last = hits[hits.length - 1];
            if ((performance.now() - last.createdAtPerf) / 1000 < 1.6) {
              const sign = last.offsetMs > 0 ? '+' : '';
              const label =
                last.verdict === 'unmatched'
                  ? 'LIBRE'
                  : `${last.verdict === 'locked' ? 'OK' : 'DESV'} ${sign}${last.offsetMs} MS`;
              ctx.fillStyle = last.verdict === 'locked' || last.verdict === 'good' ? '#166534' : '#E63B19';
              ctx.font = '600 10px "IBM Plex Mono", monospace';
              ctx.textAlign = 'right';
              ctx.fillText(label, w - 12, 16);
            }
          }

          ctx.restore();
        }
      }
      rafId = window.requestAnimationFrame(render);
    };

    rafId = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(rafId);
  }, [engine, lookAheadSec]);

  return (
    <div className="w-full h-64 sm:h-72 border-y border-[#111111] bg-white">
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
};
