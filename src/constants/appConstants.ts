// ============================================
// COLORS
// ============================================

export const COLORS = {
  brown: '#4E2F1F',
  dark: '#5A343D',
  pink: '#FCD6DD',
  background: '#FFF8FA',
  white: '#FFFFFF',
  accent: '#D86C89',
  text: '#4E2F1F',
  muted: '#8E7770',
  border: '#F2DDE5',
  gray: '#A9A0A0',
  lightGray: '#F2F2F2',
  success: '#39734A',
  successBackground: '#EFF8F2',
  warning: '#F9A825',
  error: '#A04444',
  guideGreen: '#4F9B67',
  guideYellow: '#D9A72E',
  guideRed: '#D64F5A',
  waveform: '#D45C78',
  completedPink: '#D94F78',
  lightGreen: '#DFF2E6',
  transparentbrown: 'rgba(45, 29, 25, 0.4)',
  black: '#000'
} as const;

// ============================================
// TIMING
// ============================================

export const TIMING = {
  COUNTDOWN_SECONDS: 3,
  PRE_RECORDING_DELAY_MS: 1500,
  RECORDING_INTERVAL_MS: 100,
  TIMER_TICK_MS: 100,
  PROCESSING_MIN_DURATION_MS: 350,
  PROCESSING_DELAY_MS: 1200,
  REST_SECONDS: 2,
} as const;

// ============================================
// AUDIO
// ============================================

export const AUDIO = {
  SAMPLE_RATE: 44100,
  BUFFER_SIZE: 4410,
  FFT_SIZE: 1024,
  FFT_HOP_SIZE: 512,
  LIVE_BUFFER_SIZE: 4096,
  LIVE_ANALYSIS_SIZE: 2048,
  WINDOW_MS: 50,
} as const;

// ============================================
// PITCH
// ============================================

export const PITCH = {
  MIN_PITCH_HZ: 60,
  MAX_PITCH_HZ: 1000,
  MIN_VOICE_CLARITY: 0.45,
  MIN_PITCH_CONFIDENCE: 0.65,
  MIN_PITCH_CORRELATION: 0.7,
  GOOD_NOTE_SEMITONES: 0.5,
  CLOSE_NOTE_SEMITONES: 1.5,
  STABILITY_WINDOW_SIZE: 20,
  MIN_STABILITY_READINGS: 5,
} as const;

// ============================================
// RECORDING
// ============================================

export const RECORDING = {
  DEFAULT_MAX_DURATION_SECONDS: 10,
  MIN_DURATION_SECONDS: 0.25,
  MIN_RMS: 0.001,
  END_PADDING_MS: 500,
  BUFFER_DURATION_SECONDS: 20,
  EXTRA_RECORDING_TIME_SECONDS: 1,
} as const;

// ============================================
// VISUALIZATION
// ============================================

export const VISUALIZATION = {
  WAVE_COUNT: 18,
  WAVEFORM_BAR_COUNT: 30,
  BAR_COUNT: 32,
  PITCH_HISTORY_LIMIT: 20,
  GUIDE_TRACE_LIMIT: 18,
  MAX_LIVE_HISTORY: 40,
  HISTORY_LIMIT: 60,
  DBFS_MIN: -60,
  DBFS_MAX: -10,
  METER_GRAY: '#EAE3E5',
} as const;