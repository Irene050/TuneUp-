# From audio recording to scores

This guide explains how recording flows into measurement and scoring across the app. It covers all 30 screens that use the shared audio recorder:

- 25 scored exercises: five each for Breath Control, Pitch, Tone, Volume, and Agility.
- Three Free Mode screens, which show live readings but do not produce exercise scores.
- Two dashboard assessments.

The exercise sections are ordered **Breath Control, Pitch, Tone, Volume, Agility**. File paths and file links are intentionally omitted; function and component names are retained where they help explain the flow.

## The shared recording flow

### 1. Microphone capture

`useAudioRecorder` wraps `AudioRecorder` and `AudioManager` from `react-native-audio-api`.

When a screen starts recording, the hook:

1. Requests microphone permission and reports permission or startup errors.
2. Configures the audio session and starts mono capture at 44,100 Hz with 2,048-frame buffers.
3. Copies channel-0 samples from each native callback into `Float32Array` chunks and tracks the total sample count.
4. Computes live RMS, peak amplitude, and dB for the current chunk.

### 2. Live frames are for feedback

At most every 100 ms, the hook emits an `onFrame` callback with the current audio chunk, sample rate, volume, and pitch/note/clarity fields. Pitch analysis is enabled by default; screens that pass `analyzePitch: false` still receive audio and volume, but no-pitch values for pitch fields.

Screens use these frames for live meters, pitch labels, voiced-frame checks, and repetition progress. They are feedback and timing data—not automatically the final score. For example, `SharedVolumeComponent` draws the live bars and ramp guide for crescendo/decrescendo; it does not record, analyze the completed buffer, or score the exercise.

### 3. Stop, validate, and assemble

`stopRecording()` stops the native recorder, clears its audio callback, deactivates the audio session, joins the saved chunks into one contiguous sample array, and calls `onStop(samples, sampleRate)`. Cancellation and unmount cleanup discard the recording. Screens also ignore stops that belong to a paused, quit, or interrupted attempt.

Many screens use `hasSufficientRecordedSignal` before analysis. Its basic signal gate requires:

- A non-empty sample buffer.
- RMS of at least `0.002`.
- Peak amplitude of at least `0.01`.
- At least 1% of samples with absolute amplitude of `0.005` or more.

Repetition-based screens may split, trim, zero-pad, or join recordings. `fixedDurationSamples` makes a segment the requested sample length; `concatenateRepetitions` joins usable segments without gaps. The exact retry and segment rules vary by exercise.

### 4. Measure, score, and save

The stopped samples are time-domain audio. The exercise-specific measurement converts them into useful features—such as RMS windows, pitch frames, stable note events, FFT frames, active breath segments, or pulses. A scorer then combines those measurements and applies the exercise's passing rules.

Screens supply the target notes, duration, repetitions, and thresholds. These may be adjusted by difficulty tier or adaptive progression, so a configured threshold can vary between attempts. Scored exercises show a result and save exercise progress. Free Mode and dashboard assessments have separate result flows described later.

## 1. Breath Control

Breath exercises analyze either a complete recording or the exhale portion saved by the screen. Common measurements include active-segment onset/offset, duration, RMS level, consistency, and pulse timing. Sound level is a microphone-based proxy; it is not a direct measurement of airflow.

### Controlled Breath Release

The screen records the pulse sequence. `measureControlledBreathRelease` detects pulse peaks and their intervals, then returns pulse consistency and interval accuracy.

- **Score:** 60% pulse consistency + 40% interval accuracy.
- **Pass:** pulse consistency meets the configured threshold and the requested number of pulse peaks is detected.

### Diaphragmatic Breathing

The screen passes the exhale samples for `measureDiaphragmaticBreathing`. It detects the exhale boundaries and measures exhale duration, RMS consistency, and audio level.

- **Score:** 40% duration + 60% consistency.
- **Pass:** duration reaches the target, consistency reaches the configured threshold, and the score is at least 75.

### Steady Airflow

`measureSteadyAirflow` identifies the active sound segment and measures its duration and RMS stability.

- **Score:** 40% duration + 60% stability.
- **Pass:** the segment reaches the target duration, stability meets the configured threshold, and the score is at least 75.

### Sustained Exhale

Sustained Exhale uses the shared `measureSustainedBreath` and `scoreSustainedBreath` logic. Measurement identifies the active exhale and evaluates its duration and consistency.

- **Score:** 30% duration + 70% consistency.
- **Pass:** consistency is at least the greater of the configured threshold or 85, and the total score is at least 85. Exhale must reach its configured maximum/target duration (as well as its minimum); this is a target to reach, not an upper cap.

### Sustained SSSS

SSSS uses the same sustained-breath measurement and scoring as Sustained Exhale, but it has a separate screen and parameter generator.

- **Score:** Same 30% duration + 70% consistency formula.
- **Pass:** Same consistency and total-score floors; its duration rule requires the configured minimum only. The configured maximum still defines the full-duration score target, but is not a minimum pass requirement as it is for Sustained Exhale.

## 2. Pitch

Pitch screens compare detected frequencies or note sequences with target notes. Depending on the exercise, each recording may be analyzed as a complete attempt, segmented into target-note windows, or scored separately as a repetition. Clarity filtering and minimum voiced-data requirements prevent silence or unreliable pitch estimates from counting as accurate singing.

### Note Matching

`measureNoteMatching` tracks pitch over time, filters frames by clarity, and summarizes the voiced frequency with a median. The scorer compares voiced frames with the target note's tolerance.

- **Pass:** at least 90% match rate and at least 85 accuracy, plus the configured clarity and minimum-frame requirements.
- **Important:** an absent or unclear pitch is not a successful match.

### Interval Recognition

`measureIntervalRecognition` groups stable pitch frames into note events and derives intervals from frequency ratios. Each attempt is compared with the requested interval.

- **Score:** attempt scores are aggregated; missing attempts count as zero.
- **Pass:** all requested repetitions must have a detected result within the configured interval tolerance, each must meet the 85-point requirement, and the aggregate score must be at least 85.

### Scale Accuracy

The screen divides a recording into target-note windows. `measureScaleAccuracyDrill` estimates the median voiced pitch in each window and measures transition smoothness.

- **Score:** 95% note accuracy + 5% transition smoothness.
- **Pass:** note accuracy meets the greater of the configured threshold or 85; at least 80% of target notes are correct and at least 80% are voiced; total score is at least 85.

### Melodic Pattern Matching

The screen segments the recording by reference note and retains timing information. `measureMelodicPatternMatching` supplies detected frequencies and timestamps; the scorer compares note hits, pattern accuracy, and rhythm.

- **Score:** 80% pattern accuracy + 20% rhythm accuracy.
- **Pass:** at least 80% of notes are hit, pattern accuracy is at least 75, rhythm accuracy is at least 60, and total score is at least 75.
- **Repetitions:** missing repetitions count as zero in the aggregate.

### Sustained Note Stability

Each repetition is measured independently. `measureSustainedNoteStability` filters pitch frames by clarity and estimates pitch spread in cents.

- **Score per repetition:** 80% stability + 20% duration, then multiplied by the pitch-accuracy factor.
- **Pass per repetition:** pitch accuracy is at least 70, pitch spread is within the configured cents limit, duration reaches its target, and the repetition score is at least 80.
- **Overall score/pass:** missing repetitions count as zero in the average, every requested repetition must pass, and the aggregate score must be at least 80. A good repetition cannot erase a failed one.

## 3. Tone

Tone exercises use live pitch/level readings for feedback. Spectral exercises transform the completed audio into FFT frames. The common `samplesToFFTFrames` settings are a 1,024-sample frame, 512-sample hop, and a minimum frame RMS of `0.01`; quieter frames are skipped.

### Frequency Zone Stability

This exercise analyzes the screen's collected pitch history rather than relying only on one stopped pitch estimate. It evaluates pitch stability, frequency-zone stability, valid-pitch coverage, and duration.

- **Score:** 70% stability + 20% coverage + 10% duration.
- **Pass:** at least eight valid pitch frames, coverage of at least 70%, required duration, stability of at least the greater of the configured threshold or 65, and a total score of at least 60.

### Steady Tone Holding

After recording, the screen creates FFT frames. `measureSteadyToneHolding` evaluates spectral-centroid smoothness, amplitude consistency, and pitch stability to form a tone-quality measurement.

- **Score:** 70% tone quality + 30% duration score, with the duration contribution scaled by `0.96`.
- **Pass:** tone quality reaches the configured quality threshold and the recording reaches the required duration.

### Tone Consistency

Each repetition produces its own sample buffer and FFT frames. `measureToneConsistency` compares spectral centroids and amplitudes across repetitions to quantify how consistently the tone was produced.

- **Score:** cross-repetition consistency scaled by `0.96`.
- **Pass:** the measured consistency meets the configured threshold.

### Vowel Consistency

The recording is converted to FFT frames; `measureVowelConsistency` tracks spectral centroid over time and derives smoothness.

- **Score:** the smoothness score.
- **Pass:** the measurement is valid and score meets the greater of the configured threshold or 75.

### Waveform Smoothness

`measureWaveformSmoothness` measures spectral-centroid smoothness and amplitude stability.

- **Score:** 60% centroid smoothness + 40% amplitude stability.
- **Pass:** both component scores meet the greater of the configured threshold or 60, and the total score is at least 60.

## 4. Volume

Volume screens use 50 ms RMS windows, converted to dB. The shared `VOLUME_ANALYSIS_WINDOW_MS` setting defines the window length; each exercise adds its own silence handling, transforms, segmentation, and quality checks. Live displays are separate from this completed-recording analysis.

### How Volume repetitions are assembled

- **Crescendo and Decrescendo:** stopped repetition segments are collected and joined before measurement.
- **Volume Band Targeting:** repetitions are validated individually, fixed to a consistent duration, then joined. A fixed-size slot is reserved for each repetition.
- **Dynamic Range:** one continuous recording is split using saved repetition time intervals; valid segments are padded or trimmed before joining.
- **Volume Control Stability:** the completed recording is split into fixed-duration repetitions; a retry can replace a failed repetition.

Silence is commonly ignored below `-60 dBFS`. Tier parameters can change duration, target range, repetition count, and passing threshold. The live crescendo/decrescendo ramp component and the other Volume meters only present feedback; they do not calculate the score.

### Controlled Crescendo

The screen joins valid repetition buffers. Measurement ignores windows at or below `-60 dBFS`, analyzes the expected duration, and evaluates the upward ramp, smoothness, end level, and required volume increase.

- **Score:** smoothness is the overall score.
- **Pass:** valid measurement windows, target reached, and passing score met (75 by default).

### Controlled Decrescendo

The screen trims each repetition to its expected duration and joins the buffers. Measurement treats silence as invalid and negates valid dB values so a physical decrease can be analyzed as an increasing internal value. It checks each repetition's direction, decrease amount, start/end target tolerance, and smoothness.

- **Score:** average smoothness across repetitions.
- **Pass:** at least 20 valid windows, at least 60% measurement quality, valid per-repetition scores, correct direction, target attainment, and an overall score meeting the configured threshold (75 by default).

### Dynamic Range

The screen records continuously and extracts repetitions from saved time intervals. Measurement divides each repetition into rising, peak, and falling phases, then evaluates peak contrast against the target range and the consistency of the ramp directions and peak shape. The screen rejects results with less than 50% measurement quality or no valid windows before scoring.

- **Score:** 40% range accuracy + 60% ramp consistency.
- **Pass:** configured overall score, 75 by default.

### Volume Band Targeting

Each repetition is validated and fixed to the target duration before joining. Measurement ignores windows below `-60 dBFS`, shifts remaining levels by 70 for its target/display scale, and compares repetition averages with the target band and tolerance. It also reports consistency and measurement quality.

- **Score:** consistency is the overall score.
- **Pass:** usable measurement, at least 50% measurement quality by default, target attainment, and score meeting the configured threshold (60 by default).

### Volume Control Stability

The screen uses live pitch/clarity for its voiced display, then splits the completed recording into fixed-duration repetitions. Measurement uses 50 ms windows and a `-60 dBFS` voiced-window floor. It measures variation in voiced RMS values overall and per repetition; voiced coverage contributes to the duration score. Measurement quality combines coverage and stability.

- **Score:** 70% stability + 30% duration/voiced coverage.
- **Pass:** usable audio, at least 20% voiced coverage, and score meeting the target stability threshold (70 by default).

## 5. Agility

Agility analysis re-examines the completed audio to find pitch frames, stable note events, and transitions. Shared helpers extract pitch frames and candidate notes, but each exercise aligns the note events to a different target and scores speed or interval behavior differently.

### Arpeggio Speed

Measurement extracts confirmed notes, aligns detected pitches and sequence to the target, and calculates notes per second.

- **Score:** 40% pitch + 35% sequence + 25% speed.
- **Pass:** overall score of at least 70, pitch score of at least 60, and sequence score of at least 60.

### Quick Interval Jump

Measurement confirms stable note events, aligns them to target notes, and measures interval accuracy and transition time.

- **Score:** 40% pitch + 40% interval + 20% speed.
- **Pass:** overall score of at least 70, pitch score of at least 60, and interval score of at least 60.

### Rapid Note Transition

Measurement aligns detected notes to the target sequence and measures transition rate.

- **Score:** 40% pitch + 30% sequence + 30% speed.
- **Pass:** overall score meets the configured accuracy threshold, with pitch and sequence scores each at least 60.

### Rapid Scale Trill

Measurement expands the target across repetitions and evaluates pitch, note sequence, transitions, and notes per second. It also returns per-repetition details.

- **Score:** 35% pitch + 30% sequence + 20% transitions + 15% speed.
- **Pass:** overall score meets the configured threshold, and pitch and sequence scores are each at least 60.

### Vocal Run Accuracy

The screen aggregates its repetitions. Measurement aligns detected notes to the target and measures note and transition accuracy.

- **Score:** 40% pitch + 35% sequence + 25% transitions.
- **Pass:** overall score of at least 70, pitch of at least 60, and sequence accuracy at the configured threshold.

## Live-only Free Mode

Free Mode screens use `onFrame` to continuously measure a current or rolling buffer. They do not call the scored exercise measurement-and-scoring pairs and do not produce exercise scores.

- **Breath Control Free Mode:** measures live dB level and RMS consistency, then displays a normalized flow history.
- **Pitch Free Mode:** displays detected frequency and recent-frame pitch stability.
- **Volume Free Mode:** displays the live dB/volume level and level history.

## Dashboard assessments

### Component Assessment

The assessment records separate samples for low and high comfortable hums, Breath Control, Pitch, Tone, Volume, and Agility. Comfortable-note recordings are four seconds each; the component targets are 10 seconds for Breath Control, five seconds each for Pitch, Tone, and Volume, and eight seconds for Agility. The two hum recordings are used to detect vocal range; the five component recordings are kept as separate sample buffers with their sample rate.

The low and high hums must both be detectable, ordered correctly, and at least three semitones apart. The resulting range is used to generate target notes for Pitch and an Agility run. After capture, `runAssessment` calculates five component percentages using assessment-specific measurement logic and derives a recommendation band for each. It returns component scores rather than one combined overall score. Each metric is isolated: an invalid, non-finite, or failed component calculation becomes zero rather than preventing the other component results. The screen saves the assessment through `saveAssessment`.

### Singing Assessment

The screen records a guided melody with a beat track. The beat helps the singer follow the reference but is not part of the scoring audio. On stop, `calculateSingingAssessmentScore` validates the recording, extracts overlapping pitch frames, removes quiet or unclear frames, segments detected notes, and aligns them to the reference melody.

The melody guide runs at 100 BPM. Key reliability checks include a minimum five-second recording, at least 12 voiced frames, at least four detected note events, and voiced coverage of at least 12%. Pitch frames require sufficient level and clarity and fall within the supported frequency range. Alignment searches start offsets from zero to two seconds in 50 ms steps instead of assuming the recording began exactly with the guide.

- **Overall score:** 80% pitch accuracy + 20% pitch stability.
- **Vocal consistency:** microphone-level consistency is calculated for feedback, but is not included in the overall score.
- **Result:** the screen displays and saves the assessment result to singing-assessment history.

## What is shared—and what is not

The shared recorder standardizes microphone permission, audio-session lifecycle, live frames, and delivery of the completed sample buffer. It does **not** make every exercise use the same analysis or score.

Each screen still owns its prompts, recording duration, pauses, repetitions, retry policy, target generation, and result presentation. Its measurement and scoring logic determines what a valid attempt means. This is why similar screens can share capture mechanics while having different thresholds, formulas, and pass conditions.
