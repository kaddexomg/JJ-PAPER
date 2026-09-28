/**
 * ============================================================================
 * JJ Paper — Motor de Audio Telefónico en PC para Headset (Web Audio API)
 * Generador de Tonos de Marcación, Timbrado (Ringback), DTMF y Audio en Headset
 * Garantiza que TODO el sonido, tono y experiencia auditiva ocurra 100% en la PC.
 * ============================================================================
 */

(function () {
  'use strict';

  let audioCtx = null;
  let ringbackOsc1 = null;
  let ringbackOsc2 = null;
  let ringbackGain = null;
  let ringbackTimer = null;
  let isRingbackActive = false;

  // Frecuencias DTMF estándar ITU-T
  const DTMF_FREQS = {
    '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
    '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
    '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
    '*': [941, 1209], '0': [941, 1336], '#': [941, 1477]
  };

  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  /**
   * 1. Reproduce tono DTMF de un dígito en los auriculares del Headset de la PC
   */
  function playDtmfTone(digit, durationMs = 120) {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const freqs = DTMF_FREQS[String(digit)];
      if (!freqs) return;

      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(freqs[0], now);
      osc2.frequency.setValueAtTime(freqs[1], now);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + (durationMs / 1000));

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + (durationMs / 1000));
      osc2.stop(now + (durationMs / 1000));
    } catch (_) {}
  }

  /**
   * 2. Inicia el tono de timbrado telefónico (Ringback Tone: tuuu... tuuu...) en el Headset
   * Cadencia estándar: 1.2 segundos de tono dual 440Hz + 480Hz, 3.0 segundos de silencio.
   */
  function startRingbackTone() {
    stopRingbackTone();
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      isRingbackActive = true;

      function playCycle() {
        if (!isRingbackActive) return;

        const now = ctx.currentTime;
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        // Tono dual estándar de centralita PBX / telecomunicaciones (440Hz + 480Hz)
        osc1.type = 'sine';
        osc2.type = 'sine';
        osc1.frequency.setValueAtTime(440, now);
        osc2.frequency.setValueAtTime(480, now);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.15, now + 0.05); // Ataque suave
        gain.gain.setValueAtTime(0.15, now + 1.2);
        gain.gain.linearRampToValueAtTime(0.001, now + 1.25); // Desvanecimiento

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 1.3);
        osc2.stop(now + 1.3);

        ringbackTimer = setTimeout(() => {
          if (isRingbackActive) playCycle();
        }, 4200); // 1.2s de sonido + 3s de silencio
      }

      playCycle();
    } catch (_) {}
  }

  /**
   * 3. Detiene inmediatamente el timbrado en el Headset (al contestar o colgar)
   */
  function stopRingbackTone() {
    isRingbackActive = false;
    if (ringbackTimer) {
      clearTimeout(ringbackTimer);
      ringbackTimer = null;
    }
  }

  /**
   * 4. Reproduce un Chime suave de "Llamada Conectada / En Línea"
   */
  function playConnectedChime() {
    stopRingbackTone();
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(659.25, now + 0.1); // E5
      osc.frequency.setValueAtTime(783.99, now + 0.2); // G5

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.5);
    } catch (_) {}
  }

  /**
   * 5. Reproduce el tono de Ocupado o Fin de Llamada (Busy / Disconnected)
   */
  function playCallEndedTone() {
    stopRingbackTone();
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const startTime = now + (i * 0.25);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(425, startTime);

        gain.gain.setValueAtTime(0.12, startTime);
        gain.gain.linearRampToValueAtTime(0.001, startTime + 0.18);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + 0.2);
      }
    } catch (_) {}
  }

  /**
   * 6. Prueba rápida de audio para confirmar que el Headset en la PC funciona
   */
  function testHeadsetAudio() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.3);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.45);

      if (typeof showToast === 'function') {
        showToast('🎧 Tono de prueba reproducido en el Headset de la PC.', 'info');
      }
    } catch (e) {
      console.warn('Error probando audio en Headset:', e);
    }
  }

  window.JJPhoneAudio = {
    playDtmf: playDtmfTone,
    startRingback: startRingbackTone,
    stopRingback: stopRingbackTone,
    playConnected: playConnectedChime,
    playEnded: playCallEndedTone,
    testHeadset: testHeadsetAudio,
    getContext: getAudioContext
  };

})();
