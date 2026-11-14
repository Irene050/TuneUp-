export const COLORS = {
  brown: '#4E2F1F',
  darkBrownText: '#4A302F',
  dark: '#5A343D',
  pink: '#FCD6DD',
  otherpink: '#EAA5B6',
  background: '#FFF8FA',
  white: '#FFFFFF',
  accent: '#D86C89',
  text: '#4E2F1F',
  muted: '#8E7770',
  inputPlaceholder: '#A99C9A',
  border: '#F2DDE5',
  gray: '#A9A0A0',
  lightGray: '#F2F2F2',
  success: '#39734A',
  successBackground: '#EFF8F2',
  warning: '#F9A825',
  error: '#A04444',
  alertIcon: '#A33A3A',
  guideGreen: '#4F9B67',
  guideYellow: '#D9A72E',
  lightYellow: '#FBE6B8',
  guideRed: '#D64F5A',
  waveform: '#D45C78',
  completedPink: '#D94F78',
  lightGreen: '#DFF2E6',
  transparentbrown: 'rgba(45, 29, 25, 0.4)',
  black: '#000'
} as const;

export const EXERCISE_COUNTDOWN_SECONDS = 3;
export const EXERCISE_FINAL_RESULT_DELAY_MS = 100;
export const EXERCISE_RECORDING_BUFFER_SECONDS = 0.8;
export const EXERCISE_RECORDING_INTERVAL_MS = 100;
export const EXERCISE_FFT_SIZE = 1024;
export const EXERCISE_FFT_HOP_SIZE = 512;
export const VOLUME_HISTORY_BAR_COUNT = 32;
export const VOLUME_RAMP_BAR_COUNT = 28;
export const TONE_WAVEFORM_BAR_COUNT = 30;
export const AUDIO_SAMPLE_RATE = 44100;
export const AUDIO_BUFFER_SIZE = 4410;
export const EXERCISE_MAX_RECORDING_SECONDS = 10;
export const EXERCISE_REFERENCE_NOTE_DURATION_SECONDS = 1.5;
export const VOLUME_ANALYSIS_WINDOW_MS = 50;
export const VOLUME_DBFS_MIN = -60;
export const VOLUME_DBFS_MAX = -10;
export const LIVE_VOICE_DETECTION_THRESHOLD_DB = -45;
export const AGILITY_GOOD_NOTE_SEMITONES = 0.5;
export const AGILITY_CLOSE_NOTE_SEMITONES = 1.5;
export const PITCH_GUIDE_MAX_CENTS = 100;