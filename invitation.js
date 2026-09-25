(function () {
  'use strict';

  const DURATIONS = Object.freeze([15, 25, 20, 25, 20, 20, 25, 30]);
  const numbers = new Intl.NumberFormat('ar-u-nu-arab', { useGrouping: false });
  const digits = (value) => numbers.format(value);
  const padded = (value) => numbers.format(value).padStart(2, '٠');

  function parseTime(value) {
    if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  }

  function formatTime(minutes) {
    const time = ((minutes % 1440) + 1440) % 1440;
    const hours = Math.floor(time / 60);
    return `${digits(hours % 12 || 12)}:${padded(time % 60)} ${hours < 12 ? 'ص' : 'م'}`;
  }

  function buildSchedule(startTime) {
    const start = parseTime(startTime);
    if (start === null) return [];
    let minute = start;
    return DURATIONS.map((duration) => {
      const event = { start: minute, end: minute + duration, duration };
      minute += duration;
      return event;
    });
  }

  function eventTimestamp(date, startTime, utcOffset) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || parseTime(startTime) === null) return null;
    if (typeof utcOffset !== 'string' || !/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(utcOffset)) return null;
    if (utcOffset.slice(1, 3) === '14' && utcOffset.slice(4) !== '00') return null;
    const calendar = new Date(`${date}T12:00:00Z`);
    if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== date) return null;
    const timestamp = Date.parse(`${date}T${startTime}:00${utcOffset}`);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function countdownParts(target, now) {
    if (!Number.isFinite(target) || !Number.isFinite(now)) return null;
    const remaining = Math.max(0, Math.ceil((target - now) / 1000));
    return {
      days: Math.floor(remaining / 86400),
      hours: Math.floor(remaining / 3600) % 24,
      minutes: Math.floor(remaining / 60) % 60,
      seconds: remaining % 60,
      finished: remaining === 0
    };
  }

  function cleanText(value, limit) {
    return typeof value === 'string' ? value.trim().slice(0, limit) : '';
  }

  function normalizePhone(value) {
    const phone = String(value || '').replace(/[\s()+-]/g, '');
    return /^[1-9]\d{7,14}$/.test(phone) ? phone : '';
  }

  function mapUrl(value) {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      const isMapHost = host === 'maps.app.goo.gl' || host === 'maps.apple.com' ||
        host === 'goo.gl' || /^(?:www\.|maps\.)?google\.(?:com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(host) ||
        /^(?:www\.)?openstreetmap\.org$/.test(host);
      return url.protocol === 'https:' && isMapHost && !url.username && !url.password ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function composeRsvp(values, wedding) {
    const name = cleanText(values.guestName, 80);
    const attending = values.attendance === 'yes';
    const count = Number(values.guestCount);
    if (!name) throw new Error('يرجى كتابة الاسم.');
    if (!['yes', 'no'].includes(values.attendance)) throw new Error('يرجى اختيار حالة الحضور.');
    if (attending && (!Number.isInteger(count) || count < 1 || count > 10)) throw new Error('يرجى اختيار عدد بين ١ و١٠ أشخاص.');
    const lines = [
      `إلى ${cleanText(wedding.bride, 80)} و${cleanText(wedding.groom, 80)} 🤍`,
      `الاسم: ${name}`,
      attending ? 'بكل محبة، أؤكد حضوري لفرحتكم.' : 'أعتذر عن الحضور، وأتمنى لكم فرحة لا تنتهي.'
    ];
    if (attending) lines.push(`عدد الحضور (بما فيهم أنا): ${digits(count)}`);
    const message = cleanText(values.message, 500);
    if (message) lines.push(`رسالتي لكم: ${message}`);
    return lines.join('\n');
  }

  const helpers = { DURATIONS, parseTime, formatTime, buildSchedule, eventTimestamp, countdownParts, normalizePhone, mapUrl, composeRsvp };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const wedding = Object.assign({
    bride: 'اسم العروس', groom: 'اسم العريس', date: null, startTime: '19:00',
    utcOffset: '+03:00', whatsapp: '', venues: []
  }, window.WEDDING || {});
  const byId = (id) => document.getElementById(id);
  const setText = (id, value) => { const element = byId(id); if (element) element.textContent = value; };
  let isPreview = window.self !== window.top;
  let presentationStarted = false;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const schedule = buildSchedule(wedding.startTime);
  const timestamp = eventTimestamp(wedding.date, wedding.startTime, wedding.utcOffset);
  const dateLabel = timestamp === null ? 'موعد فرحتنا يُعلن قريبًا' : new Intl.DateTimeFormat('ar-u-nu-arab', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  }).format(new Date(`${wedding.date}T12:00:00Z`));
  const labels = {
    bride: wedding.bride, groom: wedding.groom, date: dateLabel,
    startTime: schedule.length ? formatTime(schedule[0].start) : 'يُحدد قريبًا',
    endTime: schedule.length ? formatTime(schedule[schedule.length - 1].end) : 'يُحدد قريبًا'
  };

  document.querySelectorAll('[data-bind]').forEach((element) => {
    if (Object.hasOwn(labels, element.dataset.bind)) element.textContent = labels[element.dataset.bind];
  });
  document.querySelectorAll('[data-event-time]').forEach((element) => {
    const event = schedule[Number(element.dataset.eventTime)];
    element.textContent = event ? `${formatTime(event.start)} — ${formatTime(event.end)}` : 'يُحدد قريبًا';
  });
  document.querySelectorAll('[data-event-duration]').forEach((element) => {
    const duration = DURATIONS[Number(element.dataset.eventDuration)];
    if (duration) element.textContent = `${digits(duration)} دقيقة`;
  });
  setText('scheduleNote', timestamp === null
    ? 'برنامج مقترح لثلاث ساعات · تتأكد الأوقات مع تحديد الموعد'
    : 'ثلاث ساعات نكتب فيها أجمل ذكرياتنا معكم');

  (Array.isArray(wedding.venues) ? wedding.venues : []).slice(0, 2).forEach((venue, index) => {
    if (!venue || typeof venue !== 'object') return;
    if (venue.name) setText(`venueName${index}`, venue.name);
    if (venue.address) setText(`venueAddress${index}`, venue.address);
    const link = byId(`venueLink${index}`);
    if (link) {
      const href = mapUrl(venue.mapsUrl);
      link.hidden = !href;
      if (href) { link.href = href; link.rel = 'noopener noreferrer'; link.target = '_blank'; }
    }
  });

  let countdownTimer;
  function updateCountdown() {
    const parts = countdownParts(timestamp, Date.now());
    document.querySelectorAll('[data-count]').forEach((element) => {
      const value = parts && parts[element.dataset.count];
      const next = typeof value === 'number' ? padded(value) : '—';
      if (element.textContent !== next) element.textContent = next;
    });
    setText('countdownNote', !parts ? 'نترقّب موعد فرحتنا' : parts.finished ? 'حلّ موعد فرحتنا 🤍' : 'كل ثانية تقرّبنا من أجمل لقاء');
    if (parts && parts.finished && countdownTimer) window.clearInterval(countdownTimer);
  }
  updateCountdown();

  const revealElements = document.querySelectorAll('.reveal');
  document.documentElement.classList.add('js');
  if (isPreview) document.body.classList.add('is-preview');
  const petals = byId('petals');
  function startPetals() {
    if (!petals || motion.matches || isPreview || petals.childElementCount) return;
    const fragment = document.createDocumentFragment();
    const count = window.innerWidth <= 540 ? 12 : 16;
    for (let i = 0; i < count; i++) {
      const petal = document.createElement('span');
      const isFlower = i % 4 === 0;
      petal.className = isFlower ? 'petal petal--flower' : 'petal';
      if (isFlower) {
        const flower = document.createElement('span');
        flower.className = 'rose';
        for (let petalIndex = 0; petalIndex < 10; petalIndex++) flower.appendChild(document.createElement('i'));
        petal.appendChild(flower);
      }
      // Keep whole roses nearer the edges so the invitation stays easy to read.
      const lane = isFlower ? [8, 83, 20, 72][i / 4] : 5 + (i / count) * 87;
      const flowerSize = 29 + Math.random() * 8;
      petal.style.setProperty('--left', `${lane + Math.random() * 4}%`);
      petal.style.setProperty('--delay', `${-0.7 - i * 1.17}s`);
      petal.style.setProperty('--duration', `${16 + Math.random() * 6}s`);
      petal.style.setProperty('--sway', `${Math.round(Math.random() * 70 - 35)}px`);
      petal.style.setProperty('--turn', `${Math.round(Math.random() * 160 + 100)}deg`);
      petal.style.setProperty('--size', `${isFlower ? flowerSize : 9 + Math.random() * 7}px`);
      if (isFlower) petal.style.setProperty('--rose-scale', String(flowerSize / 44));
      fragment.appendChild(petal);
    }
    petals.appendChild(fragment);
  }
  motion.addEventListener?.('change', (event) => {
    if (event.matches) {
      revealElements.forEach((element) => element.classList.add('is-visible'));
      petals?.replaceChildren();
    } else if (presentationStarted) startPetals();
  });

  const timeline = byId('celebrationTimeline');
  let scrollPending = false;
  function updateJourney() {
    scrollPending = false;
    if (!timeline) return;
    const rect = timeline.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, (window.innerHeight * 0.55 - rect.top) / Math.max(1, rect.height)));
    timeline.style.setProperty('--journey-progress', String(progress));
    timeline.querySelectorAll('[data-event]').forEach((element) => {
      const dot = element.querySelector('.timeline-dot');
      const markerPosition = element.offsetTop + (dot ? dot.offsetTop + dot.offsetHeight / 2 : 0);
      element.classList.toggle('is-passed', progress * rect.height >= markerPosition);
    });
  }
  function scheduleJourney() {
    if (!scrollPending) { scrollPending = true; window.requestAnimationFrame(updateJourney); }
  }
  function activateInvitation() {
    if (presentationStarted) return;
    presentationStarted = true;
    isPreview = false;
    document.body.classList.remove('is-preview');
    updateCountdown();
    if (timestamp !== null && timestamp > Date.now()) countdownTimer = window.setInterval(updateCountdown, 1000);
    if (!motion.matches && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
        });
      }, { threshold: 0.12 });
      revealElements.forEach((element) => observer.observe(element));
    } else revealElements.forEach((element) => element.classList.add('is-visible'));
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => document.body.classList.add('intro-ready'));
    });
    startPetals();
    if (timeline) {
      window.addEventListener('scroll', scheduleJourney, { passive: true });
      window.addEventListener('resize', scheduleJourney, { passive: true });
      window.addEventListener('load', scheduleJourney, { once: true });
      document.fonts?.ready.then(scheduleJourney);
      updateJourney();
    }
  }

  // The preloaded page becomes interactive after the envelope opens, without
  // navigating away from the document that owns the playing audio.
  window.addEventListener('message', (event) => {
    if (window.self !== window.top && event.source === window.parent && event.data?.type === 'invitation:activate') activateInvitation();
  });
  document.querySelector('.replay-link')?.addEventListener('click', (event) => {
    if (window.self === window.top) return;
    event.preventDefault();
    window.parent.postMessage({ type: 'invitation:replay' }, '*');
  });
  if (isPreview) window.parent.postMessage({ type: 'invitation:ready' }, '*');
  else activateInvitation();

  const form = byId('rsvpForm');
  const button = byId('rsvpSubmit');
  const preview = byId('rsvpPreview');
  const copy = byId('copyRsvp');
  const phone = normalizePhone(wedding.whatsapp);
  const setupNote = byId('rsvpSetupNote');
  if (setupNote) {
    setupNote.hidden = !!phone;
    setupNote.textContent = 'إرسال التأكيد يتفعّل عند إضافة رقم أصحاب الدعوة';
  }
  if (button) button.textContent = phone ? 'إرسال التأكيد عبر واتساب' : 'تجهيز رسالة الحضور';
  if (form) {
    const attendance = form.elements.namedItem('attendance');
    const guestCount = form.elements.namedItem('guestCount');
    const syncAttendance = () => {
      if (guestCount) {
        guestCount.disabled = attendance?.value === 'no';
        guestCount.required = !guestCount.disabled;
      }
    };
    form.addEventListener('change', syncAttendance);
    syncAttendance();
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const read = (name) => form.elements.namedItem(name)?.value || '';
      try {
        const text = composeRsvp({ guestName: read('guestName'), attendance: read('attendance'), guestCount: read('guestCount'), message: read('message') }, wedding);
        if (preview) { preview.textContent = text; preview.hidden = false; }
        if (copy) copy.hidden = false;
        if (phone) {
          window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
          setText('rsvpStatus', 'رسالتك جاهزة. إرسالها في واتساب يُتمّ تأكيد الحضور.');
        } else {
          setText('rsvpStatus', 'رسالتك جاهزة للنسخ؛ لم تُرسل بعد.');
        }
      } catch (error) {
        setText('rsvpStatus', error.message);
      }
    });
  }
  copy?.addEventListener('click', async () => {
    if (!preview?.textContent) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(preview.textContent);
      setText('rsvpStatus', 'نُسخت الرسالة. إرسالها لأصحاب الدعوة يُتمّ التأكيد.');
    } catch (_) {
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(preview);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setText('rsvpStatus', 'يمكنك نسخ الرسالة المحددة وإرسالها لأصحاب الدعوة.');
    }
  });
})();
