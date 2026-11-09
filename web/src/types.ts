export type StrokeKind = 'pulso' | 'acento' | 'repique';

export interface BomboEvent {
  id: number;
  t: number;
  kind: StrokeKind;
  weight: number;
  isCorte: boolean;
}

export interface TrackSection {
  id: string;
  name: string;
  start: number;
  end: number;
}

export interface BenchmarkV1 {
  matlabV1Hits: number;
  ichuyiriV2Hits: number;
  repiquesRecovered: number;
  acentosClassified: number;
}

export interface TrackCounts {
  total: number;
  pulso: number;
  acento: number;
  repique: number;
}

export interface SpectrumPoint {
  hz: number;
  db: number;
}

export interface TrackMetadata {
  id: string;
  title: string;
  sourceFile: string;
  style: string;
  duration: number;
  bpm: number;
  bomboResonanceHz: number;
  audioUrl: string;
  stems?: {
    sikus: string;
    bombos: string;
  };
  counts: TrackCounts;
  benchmarkV1: BenchmarkV1;
  sections: TrackSection[];
  bpmCurve: Array<{ t: number; bpm: number }>;
  spectrum?: SpectrumPoint[];
  waveform: number[];
  events: BomboEvent[];
}

export interface CatalogItem {
  id: string;
  title: string;
  sourceFile: string;
  duration: number;
  bpm: number;
  bomboResonanceHz: number;
  counts: TrackCounts;
  benchmarkV1: BenchmarkV1;
  trackUrl: string;
}

export type HitVerdict = 'locked' | 'good' | 'early' | 'late' | 'unmatched';

export interface LiveHitFeedback {
  id: number;
  trackTime: number;
  createdAtPerf: number;
  offsetMs: number;
  verdict: HitVerdict;
  weight: number;
  expectedKind?: StrokeKind;
  matchedEventId?: number;
  dynamicOk: boolean;
}

export interface MicMeterState {
  rms: number;
  lowRms: number;
  attRms: number;
}
