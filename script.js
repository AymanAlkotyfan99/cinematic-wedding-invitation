(() => {
  'use strict';

  const envelope = document.getElementById('envelope');
  if (!envelope) return;

  const seal = document.getElementById('waxSeal');
  const trigger = document.getElementById('envelopeTrigger');
  const replay = document.getElementById('replayEnvelope');
  const status = document.getElementById('envelopeStatus');
  const stage = document.getElementById('envelopeStage');
  const wrap = document.getElementById('envelopeWrap');
  const interior = document.getElementById('envelopeInterior');
  const invitationFrame = document.getElementById('invitationFrame');
  const portal = document.getElementById('invitationPortal');
  const entryProperties = ['--entry-top', '--entry-right', '--entry-bottom', '--entry-left', '--push-x', '--push-y', '--push-scale', '--push-origin-x', '--push-origin-y'];
  const topFlap = envelope.querySelector('[data-flap="top"]');
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const pendingWaits = new Set();
  const pendingArtwork = new Set();
  const decodedSources = new Set();
  let reducedMotion = Boolean(motion?.matches);
  let runId = 0;

  function activateInvitation(destination) {
    // Keep the page that received the gesture alive so its music never drops
    // out at the end of the opening. The preview becomes the live invitation.
    if (!portal || !invitationFrame?.contentWindow) {
      window.location.assign(destination);
      return;
    }
    envelope.dataset.state = 'invitation';
    setBusy(false);
    stage.classList.add('is-invitation');
    portal.removeAttribute('aria-hidden');
    portal.removeAttribute('inert');
    invitationFrame.removeAttribute('tabindex');
    wrap.setAttribute('inert', '');
    wrap.setAttribute('aria-hidden', 'true');
    invitationFrame.contentWindow.postMessage({ type: 'invitation:activate' }, '*');
    focus(invitationFrame);
    announce('أهلًا بكم في دعوتنا.');
  }

  window.addEventListener?.('message', (event) => {
    if (!invitationFrame?.contentWindow || event.source !== invitationFrame.contentWindow) return;
    if (event.data?.type === 'invitation:ready' && envelope.dataset.state === 'invitation') {
      invitationFrame.contentWindow.postMessage({ type: 'invitation:activate' }, '*');
    }
    if (event.data?.type === 'invitation:replay') reset();
  });

  function invitationDestination() {
    const destination = envelope.dataset.invitationUrl || 'invitation.html';
    const [path, hash] = destination.split('#');
    const preview = `${path}${path.includes('?') ? '&' : '?'}preview=1${hash ? `#${hash}` : ''}`;
    if (invitationFrame && invitationFrame.getAttribute('src') !== preview) {
      invitationFrame.setAttribute('src', preview);
    }
    return destination;
  }

  function prepareEntry() {
    if (!interior?.getBoundingClientRect || !stage?.style?.setProperty) return;
    const rect = interior.getBoundingClientRect();
    const width = window.innerWidth || document.documentElement?.clientWidth;
    const height = window.innerHeight || document.documentElement?.clientHeight;
    if (![width, height, rect.width, rect.height].every((value) => Number.isFinite(value) && value > 0)
      || ![rect.top, rect.left].every(Number.isFinite)) return;

    const clamp = (value, max) => Math.min(max, Math.max(0, value));
    const wrapRect = wrap?.getBoundingClientRect?.();
    const hasWrapRect = wrapRect && [wrapRect.width, wrapRect.height].every((value) => Number.isFinite(value) && value > 0)
      && [wrapRect.left, wrapRect.top].every(Number.isFinite);
    const values = {
      '--entry-top': `${clamp(rect.top, height)}px`,
      '--entry-right': `${clamp(width - rect.left - rect.width, width)}px`,
      '--entry-bottom': `${clamp(height - rect.top - rect.height, height)}px`,
      '--entry-left': `${clamp(rect.left, width)}px`,
      '--push-x': `${width / 2 - rect.left - rect.width / 2}px`,
      '--push-y': `${height / 2 - rect.top - rect.height / 2}px`,
      '--push-scale': String(Math.max(2.4, width / rect.width * 1.12, height / rect.height * 1.12)),
      '--push-origin-x': hasWrapRect ? `${(rect.left + rect.width / 2 - wrapRect.left) / wrapRect.width * 100}%` : '50%',
      '--push-origin-y': hasWrapRect ? `${(rect.top + rect.height / 2 - wrapRect.top) / wrapRect.height * 100}%` : '50%'
    };
    for (const [property, value] of Object.entries(values)) stage.style.setProperty(property, value);
  }

  function prepareArtwork(token) {
    const sources = new Map();
    for (const image of envelope.querySelectorAll?.('[data-flap] img') || []) {
      const key = image.currentSrc || image.src || image;
      if (typeof image.decode === 'function' && !decodedSources.has(key)) sources.set(key, image);
    }
    if (sources.size === 0) return Promise.resolve(true);

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (ready, error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(loadingNotice);
        pendingArtwork.delete(cancel);
        if (error) reject(error);
        else resolve(ready);
      };
      const cancel = () => finish(false);
      const loadingNotice = window.setTimeout(() => {
        if (token === runId) announce('جارٍ تحميل تفاصيل الظرف…');
      }, 900);
      pendingArtwork.add(cancel);

      // Keep the approved closed cover visible until its replacement can
      // actually be painted. Cache only successful decodes so retry works.
      Promise.all([...sources].map(async ([key, image]) => {
        await image.decode();
        decodedSources.add(key);
      })).then(() => finish(true), (error) => finish(false, error));
    });
  }

  // A single cancellable wait is active at a time. Reduced motion can finish
  // it immediately; reset invalidates the entire sequence before settling it.
  function wait(duration, token, element, animationName) {
    if (reducedMotion || token !== runId) return Promise.resolve();

    return new Promise((resolve) => {
      let timeout;
      const finish = () => {
        window.clearTimeout(timeout);
        element?.removeEventListener('animationend', onAnimationEnd);
        pendingWaits.delete(finish);
        resolve();
      };
      const onAnimationEnd = (event) => {
        // The attached seal and paper highlights also animate. Only this
        // flap's own unfolding can advance the sequence.
        if (event.target === element && event.animationName === animationName) finish();
      };

      pendingWaits.add(finish);
      element?.addEventListener('animationend', onAnimationEnd);
      // A fallback also handles a background tab or an animation that does
      // not fire. Entry never starts before the upper flap's wait ends.
      timeout = window.setTimeout(finish, duration + (element ? 100 : 0));
    });
  }

  function settlePendingWaits() {
    [...pendingWaits].forEach((finish) => finish());
  }

  function setBusy(busy) {
    envelope.setAttribute('aria-busy', String(busy));
    if (trigger) {
      trigger.disabled = busy || ['open', 'invitation'].includes(envelope.dataset.state);
      trigger.setAttribute('aria-busy', String(busy));
      trigger.setAttribute('aria-expanded', String(['open', 'entering', 'invitation'].includes(envelope.dataset.state)));
    }
  }

  function announce(text) {
    if (status) status.textContent = text;
  }

  function focus(element) {
    element?.focus({ preventScroll: true });
  }

  async function open() {
    if (envelope.dataset.state !== 'closed') return false;

    // Start within the original click/keyboard gesture, before any await.
    void window.WeddingAudio?.start();

    const token = ++runId;
    const destination = invitationDestination();
    envelope.dataset.state = 'glowing';
    envelope.dataset.step = 'glow';
    if (replay) replay.hidden = true;
    setBusy(true);
    announce('جارٍ فتح الظرف…');

    try {
      if (!await prepareArtwork(token) || token !== runId) return false;
    } catch {
      if (token !== runId) return false;
      reset();
      announce('تعذّر تحميل تفاصيل الظرف. اضغط على الطرف للمحاولة مجددًا.');
      return false;
    }
    announce('جارٍ فتح الظرف…');
    await wait(500, token);
    if (token !== runId) return false;

    envelope.dataset.state = 'opening';
    envelope.dataset.step = 'top';
    stage?.classList.add('is-opening');
    topFlap?.classList.add('is-open');
    if (topFlap) await wait(3600, token, topFlap, 'unfold-top');
    if (token !== runId) return false;

    envelope.dataset.state = 'open';
    envelope.dataset.step = 'complete';
    setBusy(true);

    // The upper flap stays attached and visible; the other three never move.
    // A completion listener may reset and cancel the following entry.
    envelope.dispatchEvent(new CustomEvent('envelope:opened', { bubbles: true }));
    if (token !== runId) return false;

    envelope.dataset.state = 'entering';
    envelope.dataset.step = 'entering';
    prepareEntry();
    stage?.classList.add('is-entering');
    announce('تم فتح الظرف، جارٍ الدخول إلى الدعوة…');
    await wait(2400, token);
    if (token !== runId) return false;

    activateInvitation(destination);
    return true;
  }

  function reset() {
    ++runId;
    settlePendingWaits();
    [...pendingArtwork].forEach((cancel) => cancel());
    envelope.classList.add('is-resetting');
    topFlap?.classList.remove('is-open');
    stage?.classList.remove('is-opening', 'is-entering', 'is-invitation');
    if (portal) {
      portal.setAttribute('aria-hidden', 'true');
      portal.setAttribute('inert', '');
      invitationFrame?.setAttribute('tabindex', '-1');
      wrap?.removeAttribute('inert');
      wrap?.removeAttribute('aria-hidden');
      const preview = invitationFrame?.getAttribute('src');
      if (preview) invitationFrame.setAttribute('src', preview);
    }
    window.WeddingAudio?.reset();
    entryProperties.forEach((property) => stage?.style?.removeProperty?.(property));
    envelope.dataset.state = 'closed';
    delete envelope.dataset.step;
    if (replay) replay.hidden = true;
    setBusy(false);
    announce('المس طرف الظرف لتبدأ الحكاية.');
    // Commit the closed geometry while animations are disabled so replay
    // cannot briefly show the reverse of the opening animation.
    void envelope.offsetWidth;
    envelope.classList.remove('is-resetting');
    focus(trigger);
  }

  const onMotionChange = (event) => {
    reducedMotion = event.matches;
    if (reducedMotion) settlePendingWaits();
  };
  if (motion?.addEventListener) motion.addEventListener('change', onMotionChange);
  else motion?.addListener?.(onMotionChange);

  // Back may restore the exact frame just before navigation from the browser
  // cache. Restore the closed cover so its opaque finale cannot trap guests.
  window.addEventListener?.('pageshow', (event) => {
    if (event.persisted && envelope.dataset.state === 'entering') reset();
  });

  envelope.dataset.state = 'closed';
  invitationDestination();
  if (replay) replay.hidden = true;
  setBusy(false);
  trigger?.addEventListener('click', () => {
    void open();
  });

  window.InvitationEnvelope = {
    el: envelope,
    sealEl: seal,
    get state() {
      return envelope.dataset.state;
    },
    open,
    reset
  };
})();
