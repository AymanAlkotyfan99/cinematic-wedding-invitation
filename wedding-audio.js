/* An original, gentle piano / harp waltz. Set WEDDING.audioUrl to use a recording. */
(() => {
  'use strict';
  if (window.WeddingAudio || window.parent !== window) return;

  const AudioEngine = window.AudioContext || window.webkitAudioContext;
  const beat = 60 / 72;
  const bars = [
    [[50, 57, 62, 66], [[0, 74, 1], [1, 78, .5], [1.5, 76, .5], [2, 74, 1]]],
    [[49, 57, 61, 64], [[0, 73, 1], [1, 76, 1], [2, 69, 1]]],
    [[47, 54, 59, 62], [[0, 71, 1.5], [1.5, 74, .5], [2, 78, 1]]],
    [[42, 54, 57, 61], [[0, 76, 1], [1, 73, 1], [2, 69, 1]]],
    [[43, 55, 59, 62], [[0, 71, 1], [1, 74, 1], [2, 79, 1]]],
    [[42, 54, 57, 62], [[0, 78, 1.5], [1.5, 76, .5], [2, 74, 1]]],
    [[40, 52, 55, 59], [[0, 76, 1], [1, 74, .5], [1.5, 71, .5], [2, 67, 1]]],
    [[45, 57, 61, 64], [[0, 69, 2], [2, 73, 1]]],
    [[50, 57, 62, 66], [[0, 74, 1], [1, 78, 1], [2, 81, 1]]],
    [[49, 57, 61, 64], [[0, 80, 1.5], [1.5, 78, .5], [2, 76, 1]]],
    [[47, 54, 59, 62], [[0, 78, 1], [1, 74, 1], [2, 71, 1]]],
    [[42, 54, 57, 61], [[0, 73, 2], [2, 69, 1]]],
    [[43, 55, 59, 62], [[0, 71, 1], [1, 74, 1], [2, 79, 1]]],
    [[45, 57, 61, 64], [[0, 78, 1], [1, 76, 1], [2, 73, 1]]],
    [[50, 57, 62, 66], [[0, 74, 2], [2, 78, 1]]],
    [[50, 57, 62, 66], [[0, 74, 2.7]]]
  ];
  const score = bars.flatMap(([chord, melody], bar) => [
    { at: bar * 3, note: chord[0], duration: 2.7, volume: .19 },
    ...[0, 1, 2, 3, 4, 5].map((step) => ({
      at: bar * 3 + step * .5,
      note: chord[1 + step % 3], duration: 1.8, volume: step % 2 ? .065 : .08
    })),
    ...melody.map(([at, note, duration]) => ({
      at: bar * 3 + at, note, duration: duration + .7, volume: .19
    }))
  ]).sort((a, b) => a.at - b.at);

  let context, master, instrument, media, button, ticker;
  let cursor = 0, loopStart = 0, version = 0;
  let playing = false, started = false, mode = 'synth', resumeOnVisible = false;
  const voices = new Set();

  function controls() {
    if (button || !document.body) return;
    const style = document.createElement('style');
    style.textContent = `
      .wedding-sound { position: fixed; z-index: 10000; left: max(16px, env(safe-area-inset-left)); bottom: max(16px, env(safe-area-inset-bottom)); display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-width: 44px; min-height: 44px; padding: 9px 13px; border: 1px solid rgba(142,105,53,.28); border-radius: 30px; color: #765525; background: rgba(255,247,232,.94); box-shadow: 0 3px 16px rgba(74,47,18,.08); backdrop-filter: blur(12px); cursor: pointer; font-size: 12px; line-height: 1.3; font-family: inherit; direction: rtl; }
      .wedding-sound[hidden] { display: none; }
      .wedding-sound:focus-visible { outline: 2px solid #8d6429; outline-offset: 4px; }
      .wedding-sound svg { width: 18px; height: 18px; flex: none; }
      .wedding-sound[data-playing="false"] .sound-waves { display: none; }
      .wedding-sound[data-playing="true"] .sound-off { display: none; }
      @media print { .wedding-sound { display: none; } }
    `;
    document.head.append(style);
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'wedding-sound';
    button.hidden = !!document.getElementById('envelope') && !started;
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4Z"/><path class="sound-waves" d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/><path class="sound-off" d="m16 9 6 6m0-6-6 6"/></svg><span>الموسيقى</span>';
    button.addEventListener('click', () => toggle());
    document.body.append(button);
    paint();
  }

  function paint() {
    if (!button) return;
    const label = playing ? 'إيقاف الموسيقى' : 'تشغيل الموسيقى';
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(playing));
    button.title = label;
    button.dataset.playing = String(playing);
    document.dispatchEvent(new CustomEvent('wedding-audiochange', { detail: { playing } }));
  }

  function engine() {
    if (context || !AudioEngine) return context;
    context = new AudioEngine();
    master = context.createGain();
    master.gain.value = .52;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -18;
    limiter.ratio.value = 3;
    master.connect(limiter);
    limiter.connect(context.destination);
    instrument = context.createPeriodicWave(
      new Float32Array(6), new Float32Array([0, 1, .24, .10, .035, .015])
    );
    // A quiet, filtered echo supplies a little room around the plucked notes.
    const echo = context.createDelay(1);
    echo.delayTime.value = beat * .75;
    const echoTone = context.createBiquadFilter();
    echoTone.type = 'lowpass';
    echoTone.frequency.value = 1600;
    const echoGain = context.createGain();
    echoGain.gain.value = .16;
    master.connect(echo);
    echo.connect(echoTone);
    echoTone.connect(echoGain);
    echoGain.connect(limiter);
    return context;
  }

  function note(event, when) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const length = Math.min(event.duration * beat, 3.4);
    oscillator.setPeriodicWave(instrument);
    oscillator.frequency.value = 440 * 2 ** ((event.note - 69) / 12);
    envelope.gain.setValueAtTime(.0001, when);
    envelope.gain.exponentialRampToValueAtTime(event.volume, when + .018);
    envelope.gain.exponentialRampToValueAtTime(event.volume * .48, when + .18);
    envelope.gain.exponentialRampToValueAtTime(.0001, when + length);
    oscillator.connect(envelope);
    envelope.connect(master);
    voices.add(oscillator);
    oscillator.onended = () => {
      oscillator.disconnect();
      envelope.disconnect();
      voices.delete(oscillator);
    };
    oscillator.start(when);
    oscillator.stop(when + length + .03);
  }

  function schedule() {
    if (!playing || mode !== 'synth') return;
    if (!loopStart) loopStart = context.currentTime + .06;
    // A throttled/background timer must not play a backlog of notes at once.
    if (loopStart + score[cursor].at * beat < context.currentTime - .2) {
      loopStart = context.currentTime + .06 - score[cursor].at * beat;
    }
    while (loopStart + score[cursor].at * beat < context.currentTime + .45) {
      const event = score[cursor];
      note(event, loopStart + event.at * beat);
      if (++cursor === score.length) {
        cursor = 0;
        loopStart += bars.length * 3 * beat;
      }
    }
  }

  async function start() {
    if (playing) return true;
    const request = ++version;
    started = true;
    controls();
    if (button) button.hidden = false;
    try {
      // Resume during the envelope's actual click, before any animation waits.
      const resumed = engine()?.resume().catch(() => false);
      const url = window.WEDDING?.audioUrl;
      if (url && !media) {
        media = new Audio(url);
        media.loop = true;
        media.volume = .48;
        media.preload = 'none';
      }
      if (media) {
        mode = 'recording';
        try {
          await media.play();
          await resumed;
        } catch {
          media.pause();
          media = null;
          mode = 'synth';
          await resumed;
        }
      } else {
        mode = 'synth';
        await resumed;
      }
      if (request !== version) return false;
      if (mode === 'synth' && (!context || context.state !== 'running')) return false;
      playing = true;
      if (mode === 'synth') {
        schedule();
        ticker = window.setInterval(schedule, 100);
      }
      paint();
      return true;
    } catch {
      playing = false;
      paint();
      return false;
    }
  }

  function pause() {
    ++version;
    playing = false;
    resumeOnVisible = false;
    window.clearInterval(ticker);
    media?.pause();
    context?.suspend().catch(() => {});
    paint();
  }

  function toggle() {
    if (playing) { pause(); return Promise.resolve(false); }
    return start();
  }

  function reset() {
    pause();
    for (const voice of voices) { try { voice.stop(); } catch {} }
    voices.clear();
    cursor = 0;
    loopStart = 0;
    if (media) media.currentTime = 0;
  }

  window.WeddingAudio = Object.freeze({
    start, pause, toggle, reset,
    get playing() { return playing; },
    get state() { return playing ? 'playing' : started ? 'paused' : 'idle'; }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', controls, { once: true });
  else controls();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && playing) {
      pause();
      resumeOnVisible = true;
    } else if (!document.hidden && resumeOnVisible) {
      resumeOnVisible = false;
      void start();
    }
  });
  window.addEventListener('pagehide', pause);
})();
