const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');

function setup({ reduced = false, missingEnvelope = false, minimal = false, portal = false, assets = [], invitationUrl, audio,
  rect = { top: 180, left: 320, width: 280, height: 230 },
  wrapRect = { top: 180, left: 320, width: 280, height: 500 }, viewport = { width: 1000, height: 900 } } = {}) {
  const log = [];
  const mutations = [];
  const navigations = [];
  const messages = [];
  const timers = new Map();
  let nextTimer = 0;
  let now = 0;
  let document;

  class Element {
    constructor(id) {
      this.id = id;
      this.listeners = new Map();
      this.attributes = new Map();
      this.attributeWrites = [];
      this.dataset = {};
      let hidden = false;
      Object.defineProperty(this, 'hidden', {
        get: () => hidden,
        set: (value) => { hidden = value; mutations.push({ id, property: 'hidden', value, time: now }); }
      });
      this.disabled = false;
      const properties = new Map();
      this.style = {
        setProperty: (name, value) => properties.set(name, value),
        removeProperty: (name) => properties.delete(name),
        getPropertyValue: (name) => properties.get(name) || ''
      };
      const classes = new Set();
      this.classList = {
        add: (name) => {
          classes.add(name);
          mutations.push({ id, property: 'classList.add', value: name, time: now });
          if (name === 'is-open' || id === 'waxSeal') log.push({ id, name, time: now });
        },
        remove: (...names) => names.forEach((name) => {
          classes.delete(name);
          mutations.push({ id, property: 'classList.remove', value: name, time: now });
        }),
        contains: (name) => classes.has(name)
      };
    }
    setAttribute(name, value) { this.attributes.set(name, value); this.attributeWrites.push({ name, value }); }
    getAttribute(name) { return this.attributes.get(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    addEventListener(name, callback) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(callback);
    }
    removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
    dispatchEvent(event) {
      event.target ??= this;
      for (const callback of [...(this.listeners.get(event.type) || [])]) callback(event);
    }
    focus() { document.activeElement = this; }
    querySelector(selector) {
      const side = selector.match(/data-flap="(\w+)"/)?.[1];
      return minimal ? null : flaps[side] || null;
    }
    querySelectorAll(selector) { return selector === '[data-flap] img' ? assets : []; }
  }

  const ids = Object.fromEntries(['envelope', 'envelopeTrigger', 'replayEnvelope', 'envelopeStatus', 'waxSeal', 'envelopeStage', 'envelopeWrap', 'envelopeInterior', 'invitationFrame', 'invitationPortal']
    .map((id) => [id, new Element(id)]));
  ids.envelopeInterior.rect = rect;
  ids.envelopeInterior.getBoundingClientRect = () => ids.envelopeInterior.rect;
  ids.envelopeWrap.rect = wrapRect;
  ids.envelopeWrap.getBoundingClientRect = () => ids.envelopeWrap.rect;
  ids.invitationFrame.attributes.set('src', 'invitation.html?preview=1');
  ids.invitationFrame.attributes.set('tabindex', '-1');
  ids.invitationPortal.attributes.set('aria-hidden', 'true');
  ids.invitationPortal.attributes.set('inert', '');
  ids.invitationFrame.contentWindow = {
    postMessage(data, origin) { messages.push({ type: data.type, origin, time: now }); }
  };
  const flaps = Object.fromEntries(['top', 'right', 'left', 'bottom'].map((side) => [side, new Element(side)]));
  ids.envelope.dataset.state = 'closed';
  if (invitationUrl !== undefined) ids.envelope.dataset.invitationUrl = invitationUrl;
  document = {
    body: new Element('body'),
    documentElement: { clientWidth: viewport.width, clientHeight: viewport.height },
    getElementById(id) {
      if (missingEnvelope || (minimal && id !== 'envelope') || (!portal && id === 'invitationPortal')) return null;
      return ids[id] || null;
    }
  };
  document.activeElement = document.body;
  const motion = new Element('motion');
  motion.matches = reduced;
  const lifecycle = new Element('window');
  const window = {
    WeddingAudio: audio,
    innerWidth: viewport.width,
    innerHeight: viewport.height,
    matchMedia: () => motion,
    addEventListener: lifecycle.addEventListener.bind(lifecycle),
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    location: { assign(url) { navigations.push({ url, time: now }); } }
  };
  vm.runInNewContext(source, {
    document,
    window,
    CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } }
  }, { filename: 'script.js' });

  async function flush() {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }
  async function advance(ms) {
    const end = now + ms;
    await flush();
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, timer] = next;
      now = timer.at;
      timers.delete(id);
      timer.callback();
      await flush();
    }
    now = end;
    await flush();
  }

  return {
    api: window.InvitationEnvelope, ids, flaps, log, mutations, navigations, messages, timers, document, window, flush, advance,
    message(type, source = ids.invitationFrame.contentWindow) { lifecycle.dispatchEvent({ type: 'message', data: { type }, source }); },
    pageShow(persisted) { lifecycle.dispatchEvent({ type: 'pageshow', persisted }); },
    setReduced(value) { motion.matches = value; motion.dispatchEvent({ type: 'change', matches: value }); },
    finishFlap(side, overrides = {}) {
      flaps[side].dispatchEvent({ type: 'animationend', animationName: `unfold-${side}`, ...overrides });
    }
  };
}

test('only the attached upper flap moves, all paper stays visible, then entry navigates once', async () => {
  const s = setup({ invitationUrl: 'invitation.html?guest=family' });
  assert.equal(s.ids.invitationFrame.getAttribute('src'), 'invitation.html?guest=family&preview=1');
  let opened = 0;
  s.ids.envelope.addEventListener('envelope:opened', () => {
    opened++;
    assert.equal(s.api.state, 'open');
    assert.equal(s.ids.envelope.dataset.step, 'complete');
    assert.equal(s.navigations.length, 0);
    for (const flap of Object.values(s.flaps)) assert.equal(flap.hidden, false);
  });
  const result = s.api.open();
  assert.equal(s.api.state, 'glowing');
  assert.equal(s.ids.envelopeTrigger.disabled, true);
  assert.equal(s.ids.envelope.getAttribute('aria-busy'), 'true');
  await s.advance(499);
  assert.deepEqual(s.log, []);
  assert.equal(s.api.state, 'glowing');
  await s.advance(1);
  assert.equal(s.api.state, 'opening');
  assert.equal(s.ids.envelope.dataset.step, 'top');
  assert.equal(s.ids.envelopeStage.classList.contains('is-entering'), false);
  assert.equal(s.ids.envelopeStage.style.getPropertyValue('--push-scale'), '');
  assert.equal(s.flaps.top.classList.contains('is-open'), true);
  s.finishFlap('top');
  await s.flush();
  assert.equal(s.ids.envelope.dataset.step, 'entering');
  assert.equal(s.ids.waxSeal.hidden, false);
  assert.equal(s.log.some(({ id }) => id === 'waxSeal'), false);
  assert.equal(s.navigations.length, 0);
  assert.equal(s.ids.envelopeStage.classList.contains('is-entering'), true);
  assert.equal(s.ids.envelopeTrigger.disabled, true);
  assert.equal(s.ids.envelope.getAttribute('aria-busy'), 'true');
  assert.equal(s.ids.replayEnvelope.hidden, true);
  await s.advance(2399);
  assert.equal(s.navigations.length, 0);
  await s.advance(1);
  assert.equal(await result, true);
  assert.equal(s.api.state, 'entering');
  assert.deepEqual(s.log.map(({ id }) => id), ['top']);
  assert.deepEqual(s.navigations, [{ url: 'invitation.html?guest=family', time: 2900 }]);
  assert.equal(opened, 1);
  assert.equal(s.ids.envelopeTrigger.getAttribute('aria-expanded'), 'true');
  assert.equal(s.timers.size, 0);
  assert.equal(s.flaps.top.listeners.get('animationend')?.size, 0);
  for (const side of ['right', 'left', 'bottom']) assert.equal(s.flaps[side].listeners.size, 0);
  s.finishFlap('bottom');
  await s.advance(15000);
  assert.equal(opened, 1);
  assert.equal(s.navigations.length, 1);
  s.api.reset();
  assert.deepEqual(s.mutations.filter(({ id }) => ['top', 'right', 'left', 'bottom', 'waxSeal'].includes(id)), [
    { id: 'top', property: 'classList.add', value: 'is-open', time: 500 },
    { id: 'top', property: 'classList.remove', value: 'is-open', time: 17900 }
  ]);
  for (const flap of Object.values(s.flaps)) {
    assert.equal(flap.hidden, false);
    assert.equal(flap.classList.contains('is-finished'), false);
  }
});

test('repeated clicks cannot overlap sequences or emit a second completion', async () => {
  const s = setup();
  let opened = 0;
  s.ids.envelope.addEventListener('envelope:opened', () => opened++);
  const first = s.api.open();
  assert.equal(await s.api.open(), false);
  s.ids.envelopeTrigger.dispatchEvent({ type: 'click', detail: 1 });
  await s.advance(4199);
  assert.equal(s.api.state, 'opening');
  assert.equal(opened, 0);
  assert.equal(s.navigations.length, 0);
  await s.advance(1);
  assert.equal(s.api.state, 'entering');
  assert.equal(await s.api.open(), false);
  assert.equal(opened, 1);
  assert.equal(s.navigations.length, 0);
  await s.advance(2399);
  assert.equal(s.navigations.length, 0);
  await s.advance(1);
  assert.equal(await first, true);
  assert.equal(await s.api.open(), false);
  assert.deepEqual(s.navigations, [{ url: 'invitation.html', time: 6600 }]);
  assert.deepEqual(s.log.map(({ id }) => id), ['top']);
  assert.deepEqual(s.log.map(({ time }) => time), [500]);
  for (const flap of Object.values(s.flaps)) assert.equal(flap.hidden, false);
});

test('entry targets the upper opening and starts only after the upper flap finishes lifting', async () => {
  const s = setup();
  const result = s.api.open();
  assert.deepEqual(s.ids.invitationFrame.attributeWrites, []);
  await s.advance(500);
  assert.equal(s.ids.envelopeStage.classList.contains('is-entering'), false);
  assert.equal(s.ids.envelopeStage.style.getPropertyValue('--push-scale'), '');
  await s.advance(3600);
  s.finishFlap('top');
  await s.flush();
  const value = (name) => s.ids.envelopeStage.style.getPropertyValue(name);
  assert.equal(value('--entry-top'), '180px');
  assert.equal(value('--entry-right'), '400px');
  assert.equal(value('--entry-bottom'), '490px');
  assert.equal(value('--entry-left'), '320px');
  assert.equal(value('--push-x'), '40px');
  assert.equal(value('--push-y'), '155px');
  assert.equal(value('--push-origin-x'), '50%');
  assert.equal(value('--push-origin-y'), '23%');
  assert.ok(Number(value('--push-scale')) >= 2.4);
  assert.ok(Number(value('--push-scale')) * 280 >= 1000);
  assert.ok(Number(value('--push-scale')) * 230 >= 900);
  assert.equal(s.ids.envelopeStage.classList.contains('is-entering'), true);
  assert.equal(s.navigations.length, 0);
  await s.advance(2400);
  assert.equal(await result, true);
  assert.deepEqual(s.navigations, [{ url: 'invitation.html', time: 6500 }]);
  assert.deepEqual(s.ids.invitationFrame.attributeWrites, []);
});

test('entry crop stays within the viewport and reset remeasures the opening after a resize', async () => {
  const s = setup({ viewport: { width: 320, height: 600 }, rect: { top: -40, left: -20, width: 300, height: 560 } });
  const oldRun = s.api.open();
  await s.advance(4200);
  const value = (name) => s.ids.envelopeStage.style.getPropertyValue(name);
  assert.equal(value('--entry-top'), '0px');
  assert.equal(value('--entry-left'), '0px');
  assert.equal(value('--entry-right'), '40px');
  assert.equal(value('--entry-bottom'), '80px');
  s.api.reset();
  assert.equal(await oldRun, false);
  for (const property of ['--entry-top', '--entry-right', '--entry-bottom', '--entry-left', '--push-x', '--push-y', '--push-scale', '--push-origin-x', '--push-origin-y']) {
    assert.equal(value(property), '');
  }
  const freshRun = s.api.open();
  await s.advance(500);
  s.window.innerWidth = 420;
  s.window.innerHeight = 760;
  s.ids.envelopeInterior.rect = { top: 60, left: 50, width: 220, height: 480 };
  s.ids.envelopeWrap.rect = { top: 60, left: 50, width: 220, height: 960 };
  await s.advance(3700);
  assert.equal(value('--entry-top'), '60px');
  assert.equal(value('--entry-right'), '150px');
  assert.equal(value('--entry-bottom'), '220px');
  assert.equal(value('--entry-left'), '50px');
  assert.equal(value('--push-x'), '50px');
  assert.equal(value('--push-y'), '80px');
  assert.equal(value('--push-origin-x'), '50%');
  assert.equal(value('--push-origin-y'), '25%');
  assert.equal(s.navigations.length, 0);
  await s.advance(2400);
  assert.equal(await freshRun, true);
  assert.equal(s.navigations.length, 1);
});

test('entry can use document viewport dimensions and safely skip an unmeasurable opening', async () => {
  const s = setup({ reduced: true });
  s.window.innerWidth = undefined;
  s.window.innerHeight = undefined;
  s.ids.envelopeWrap.rect.width = 0;
  assert.equal(await s.api.open(), true);
  assert.equal(s.ids.envelopeStage.style.getPropertyValue('--entry-left'), '320px');
  assert.equal(s.ids.envelopeStage.style.getPropertyValue('--push-origin-x'), '50%');
  assert.equal(s.ids.envelopeStage.style.getPropertyValue('--push-origin-y'), '50%');
  s.api.reset();
  s.ids.envelopeInterior.rect.width = 0;
  assert.equal(await s.api.open(), true);
  assert.equal(s.ids.envelopeStage.style.getPropertyValue('--push-scale'), '');
  assert.equal(s.navigations.length, 2);
});

test('child, unrelated and stale animation events cannot begin or bypass entry', async () => {
  const s = setup();
  s.api.open();
  await s.advance(500);
  s.finishFlap('top', { animationName: 'seal-glimmer' });
  s.finishFlap('top', { target: s.ids.waxSeal });
  s.finishFlap('top', { type: 'transitionend', propertyName: 'transform' });
  await s.flush();
  assert.equal(s.ids.envelope.dataset.step, 'top');
  assert.equal(s.flaps.top.hidden, false);
  s.finishFlap('top');
  await s.flush();
  assert.equal(s.ids.envelope.dataset.step, 'entering');
  assert.equal(s.flaps.right.hidden, false);
  assert.equal(s.navigations.length, 0);
  s.finishFlap('top');
  s.finishFlap('right', { animationName: 'unfold-top' });
  await s.flush();
  assert.equal(s.ids.envelope.dataset.step, 'entering');
  assert.equal(s.navigations.length, 0);
  s.api.reset();
});

test('reset during a flap cancels old work and a fresh sequence completes once', async () => {
  const s = setup();
  let opened = 0;
  s.ids.envelope.addEventListener('envelope:opened', () => opened++);
  const oldRun = s.api.open();
  await s.advance(2100);
  assert.equal(s.ids.envelope.dataset.step, 'top');
  s.api.reset();
  assert.equal(await oldRun, false);
  assert.equal(s.api.state, 'closed');
  assert.equal(s.timers.size, 0);
  assert.equal(s.ids.envelopeTrigger.disabled, false);
  assert.equal(s.document.activeElement, s.ids.envelopeTrigger);
  assert.equal(s.log.some(({ id }) => id === 'waxSeal'), false);
  assert.equal(s.flaps.top.listeners.get('animationend')?.size, 0);
  assert.equal(s.flaps.right.listeners.size, 0);
  for (const flap of Object.values(s.flaps)) {
    assert.equal(flap.classList.contains('is-open'), false);
    assert.equal(flap.classList.contains('is-finished'), false);
    assert.equal(flap.hidden, false);
  }
  assert.equal(s.navigations.length, 0);
  const freshRun = s.api.open();
  s.finishFlap('right');
  await s.advance(6600);
  assert.equal(await freshRun, true);
  assert.equal(opened, 1);
  assert.equal(s.navigations.length, 1);
});

test('reset during the initial glow prevents every remaining animation', async () => {
  const s = setup();
  const result = s.api.open();
  s.api.reset();
  await s.advance(15000);
  assert.equal(await result, false);
  assert.equal(s.api.state, 'closed');
  assert.deepEqual(s.log, []);
  assert.equal(s.navigations.length, 0);
});

test('reset during entry cancels navigation and restores the upper flap', async () => {
  const s = setup();
  let opened = 0;
  s.ids.envelope.addEventListener('envelope:opened', () => opened++);
  const result = s.api.open();
  await s.advance(6599);
  assert.equal(s.api.state, 'entering');
  assert.equal(s.navigations.length, 0);
  assert.equal(opened, 1);
  s.api.reset();
  assert.equal(await result, false);
  await s.advance(20000);
  assert.equal(s.api.state, 'closed');
  assert.equal(s.ids.envelopeStage.classList.contains('is-entering'), false);
  assert.equal(s.navigations.length, 0);
  assert.equal(s.ids.envelopeTrigger.disabled, false);
  assert.equal(s.ids.envelopeTrigger.getAttribute('aria-expanded'), 'false');
  assert.equal(s.ids.envelope.getAttribute('aria-busy'), 'false');
  assert.equal(s.timers.size, 0);
  for (const flap of Object.values(s.flaps)) {
    assert.equal(flap.hidden, false);
    assert.equal(flap.classList.contains('is-open'), false);
    assert.equal(flap.classList.contains('is-finished'), false);
  }
});

test('a completion listener can reset without a stale transition or navigation', async () => {
  const s = setup({ reduced: true });
  let opened = 0;
  s.ids.envelope.addEventListener('envelope:opened', () => {
    opened++;
    s.api.reset();
  });
  assert.equal(await s.api.open(), false);
  assert.equal(opened, 1);
  assert.equal(s.api.state, 'closed');
  assert.equal(s.ids.envelopeStage.classList.contains('is-entering'), false);
  assert.equal(s.navigations.length, 0);
  assert.equal(s.timers.size, 0);
  for (const flap of Object.values(s.flaps)) assert.equal(flap.hidden, false);
});

test('Back restores a usable closed envelope without interfering with ordinary page display', async () => {
  const s = setup();
  const result = s.api.open();
  await s.advance(500);
  s.pageShow(false);
  assert.equal(s.api.state, 'opening');
  assert.equal(s.ids.envelope.dataset.step, 'top');
  await s.advance(6100);
  assert.equal(await result, true);
  assert.equal(s.navigations.length, 1);
  s.pageShow(false);
  assert.equal(s.api.state, 'entering');
  s.pageShow(true);
  assert.equal(s.api.state, 'closed');
  assert.equal(s.ids.envelope.dataset.step, undefined);
  assert.equal(s.ids.envelopeStage.classList.contains('is-entering'), false);
  assert.equal(s.ids.envelopeTrigger.disabled, false);
  assert.equal(s.ids.envelope.getAttribute('aria-busy'), 'false');
  for (const flap of Object.values(s.flaps)) {
    assert.equal(flap.hidden, false);
    assert.equal(flap.classList.contains('is-open'), false);
    assert.equal(flap.classList.contains('is-finished'), false);
  }
  await s.advance(20000);
  assert.equal(s.navigations.length, 1);
  assert.equal(s.timers.size, 0);
});

test('reduced motion targets only the upper flap without scheduling timers', async () => {
  const s = setup({ reduced: true });
  assert.equal(await s.api.open(), true);
  assert.equal(s.api.state, 'entering');
  assert.deepEqual(s.log.map(({ id }) => id), ['top']);
  assert.equal(s.timers.size, 0);
  assert.deepEqual(s.navigations, [{ url: 'invitation.html', time: 0 }]);
  for (const flap of Object.values(s.flaps)) assert.equal(flap.hidden, false);
});

test('enabling reduced motion during opening skips all remaining waits', async () => {
  const s = setup();
  const result = s.api.open();
  await s.advance(500);
  s.setReduced(true);
  await s.flush();
  assert.equal(await result, true);
  assert.equal(s.api.state, 'entering');
  assert.equal(s.timers.size, 0);
  assert.equal(s.flaps.top.listeners.get('animationend')?.size, 0);
  assert.deepEqual(s.navigations, [{ url: 'invitation.html', time: 500 }]);
});

test('native activation enters the invitation without revealing or focusing replay', async () => {
  const s = setup({ reduced: true });
  let opened = 0;
  s.ids.envelope.addEventListener('envelope:opened', () => opened++);
  s.ids.envelopeTrigger.focus();
  s.ids.envelopeTrigger.dispatchEvent({ type: 'click', detail: 0 });
  await s.flush();
  assert.equal(s.api.state, 'entering');
  assert.equal(s.document.activeElement, s.ids.envelopeTrigger);
  assert.equal(s.ids.replayEnvelope.hidden, true);
  assert.equal(s.navigations.length, 1);
  s.ids.replayEnvelope.dispatchEvent({ type: 'click' });
  await s.flush();
  assert.equal(opened, 1);
  assert.equal(s.navigations.length, 1);
  s.api.reset();
  assert.equal(s.api.state, 'closed');
  assert.equal(s.document.activeElement, s.ids.envelopeTrigger);
  assert.equal(s.ids.envelopeStage.classList.contains('is-entering'), false);
  assert.equal(await s.api.open(), true);
  assert.equal(s.document.activeElement, s.ids.envelopeTrigger);
  assert.equal(opened, 2);
  assert.equal(s.navigations.length, 2);
});

test('completion respects focus moved away from the envelope', async () => {
  const s = setup();
  s.ids.envelopeTrigger.focus();
  s.ids.envelopeTrigger.dispatchEvent({ type: 'click', detail: 0 });
  const elsewhere = {};
  s.document.activeElement = elsewhere;
  await s.advance(6600);
  assert.equal(s.document.activeElement, elsewhere);
});

test('missing optional markup and entirely missing envelope are safe', async () => {
  assert.equal(setup({ missingEnvelope: true }).api, undefined);
  const minimal = setup({ minimal: true, reduced: true });
  assert.equal(await minimal.api.open(), true);
  assert.deepEqual(minimal.navigations, [{ url: 'invitation.html', time: 0 }]);
  minimal.api.reset();
  assert.equal(minimal.api.state, 'closed');
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('slow artwork keeps the cover in place until every unique source has decoded', async () => {
  const first = deferred();
  const second = deferred();
  let duplicateDecodes = 0;
  const s = setup({ assets: [
    { src: 'paper.png', decode: () => { duplicateDecodes++; return first.promise; } },
    { src: 'paper.png', decode: () => { duplicateDecodes++; return first.promise; } },
    { src: 'another-paper.png', decode: () => second.promise }
  ] });
  const result = s.api.open();
  await s.advance(900);
  assert.equal(s.ids.envelope.dataset.step, 'glow');
  assert.equal(s.ids.envelopeTrigger.disabled, true);
  assert.equal(s.ids.envelopeStatus.textContent, 'جارٍ تحميل تفاصيل الظرف…');
  assert.deepEqual(s.log, []);
  assert.equal(s.navigations.length, 0);
  first.resolve();
  await s.flush();
  assert.equal(s.ids.envelope.dataset.step, 'glow');
  assert.equal(duplicateDecodes, 1);
  second.resolve();
  await s.advance(499);
  assert.deepEqual(s.log, []);
  await s.advance(1);
  assert.equal(s.ids.envelope.dataset.step, 'top');
  await s.advance(15000);
  assert.equal(await result, true);
  s.api.reset();
  s.setReduced(true);
  assert.equal(await s.api.open(), true);
  assert.equal(duplicateDecodes, 1);
});

test('failed decoding restores the closed cover and allows a successful retry', async () => {
  let attempts = 0;
  const s = setup({ reduced: true, assets: [{
    src: 'paper.png',
    decode: () => ++attempts === 1 ? Promise.reject(new Error('Failed to load')) : Promise.resolve()
  }] });
  assert.equal(await s.api.open(), false);
  assert.equal(s.api.state, 'closed');
  assert.equal(s.ids.envelope.dataset.step, undefined);
  assert.equal(s.ids.envelopeTrigger.disabled, false);
  assert.equal(s.ids.envelopeStatus.textContent, 'تعذّر تحميل تفاصيل الظرف. اضغط على الطرف للمحاولة مجددًا.');
  assert.deepEqual(s.log, []);
  assert.equal(s.timers.size, 0);
  assert.equal(s.navigations.length, 0);
  assert.equal(await s.api.open(), true);
  assert.equal(attempts, 2);
  assert.equal(s.api.state, 'entering');
  assert.equal(s.navigations.length, 1);
});

test('reset cancels a pending artwork wait and its late failure cannot affect a new opening', async () => {
  const first = deferred();
  const second = deferred();
  let attempts = 0;
  const s = setup({ reduced: true, assets: [{
    src: 'paper.png', decode: () => ++attempts === 1 ? first.promise : second.promise
  }] });
  const oldRun = s.api.open();
  s.api.reset();
  assert.equal(await oldRun, false);
  await s.advance(1000);
  assert.equal(s.api.state, 'closed');
  assert.equal(s.ids.envelopeStatus.textContent, 'المس طرف الظرف لتبدأ الحكاية.');
  assert.equal(s.timers.size, 0);
  assert.equal(s.navigations.length, 0);
  const freshRun = s.api.open();
  first.reject(new Error('Old request failed'));
  await s.flush();
  assert.equal(s.api.state, 'glowing');
  assert.equal(s.ids.envelopeTrigger.disabled, true);
  second.resolve();
  assert.equal(await freshRun, true);
  assert.equal(s.api.state, 'entering');
  assert.equal(s.navigations.length, 1);
  assert.deepEqual(s.log.map(({ id }) => id), ['top']);
});

test('the preloaded invitation becomes interactive only after the complete opening and entry', async () => {
  const s = setup({ portal: true });
  const result = s.api.open();
  await s.advance(6599);
  assert.equal(s.api.state, 'entering');
  assert.equal(s.ids.invitationPortal.getAttribute('aria-hidden'), 'true');
  assert.equal(s.ids.invitationPortal.getAttribute('inert'), '');
  assert.equal(s.ids.invitationFrame.getAttribute('tabindex'), '-1');
  assert.deepEqual(s.messages, []);
  await s.advance(1);
  assert.equal(await result, true);
  assert.equal(s.api.state, 'invitation');
  assert.equal(s.ids.envelopeStage.classList.contains('is-invitation'), true);
  assert.equal(s.ids.invitationPortal.getAttribute('aria-hidden'), undefined);
  assert.equal(s.ids.invitationPortal.getAttribute('inert'), undefined);
  assert.equal(s.ids.invitationFrame.getAttribute('tabindex'), undefined);
  assert.equal(s.ids.envelopeWrap.getAttribute('inert'), '');
  assert.equal(s.ids.envelopeWrap.getAttribute('aria-hidden'), 'true');
  assert.equal(s.ids.envelope.getAttribute('aria-busy'), 'false');
  assert.equal(s.ids.envelopeTrigger.disabled, true);
  assert.equal(s.ids.envelopeTrigger.getAttribute('aria-expanded'), 'true');
  assert.equal(s.document.activeElement, s.ids.invitationFrame);
  assert.deepEqual(s.messages, [{ type: 'invitation:activate', origin: '*', time: 6600 }]);
  assert.deepEqual(s.navigations, []);
  assert.deepEqual(s.ids.invitationFrame.attributeWrites, []);
  assert.equal(await s.api.open(), false);
  assert.equal(s.messages.length, 1);
});

test('only the invitation frame can request late activation or replay, and replay restores the cover', async () => {
  let resets = 0;
  const s = setup({ portal: true, reduced: true, audio: { start() {}, reset() { resets++; } } });
  s.message('invitation:ready');
  assert.deepEqual(s.messages, []);
  assert.equal(await s.api.open(), true);
  s.message('invitation:ready', {});
  s.message('invitation:replay', {});
  assert.equal(s.messages.length, 1);
  assert.equal(s.api.state, 'invitation');
  assert.equal(resets, 0);
  s.message('invitation:ready');
  assert.equal(s.messages.length, 2);
  assert.equal(s.messages[1].type, 'invitation:activate');
  s.message('invitation:replay');
  assert.equal(s.api.state, 'closed');
  assert.equal(resets, 1);
  assert.equal(s.ids.invitationPortal.getAttribute('aria-hidden'), 'true');
  assert.equal(s.ids.invitationPortal.getAttribute('inert'), '');
  assert.equal(s.ids.invitationFrame.getAttribute('tabindex'), '-1');
  assert.equal(s.ids.envelopeWrap.getAttribute('inert'), undefined);
  assert.equal(s.ids.envelopeWrap.getAttribute('aria-hidden'), undefined);
  assert.equal(s.ids.envelopeStage.classList.contains('is-invitation'), false);
  assert.equal(s.ids.envelopeStage.classList.contains('is-entering'), false);
  assert.equal(s.ids.envelopeStage.classList.contains('is-opening'), false);
  assert.equal(s.document.activeElement, s.ids.envelopeTrigger);
  assert.equal(s.ids.invitationFrame.attributeWrites.at(-1).name, 'src');
  assert.equal(s.ids.invitationFrame.getAttribute('src'), 'invitation.html?preview=1');
  s.message('invitation:ready');
  assert.equal(s.messages.length, 2);
  assert.equal(await s.api.open(), true);
  assert.equal(s.messages.length, 3);
  assert.equal(s.api.state, 'invitation');
  assert.deepEqual(s.navigations, []);
});

test('music starts inside the original gesture before artwork awaits and is stopped by reset', async () => {
  const artwork = deferred();
  const audioPlayback = deferred();
  const order = [];
  const s = setup({ portal: true, reduced: true,
    assets: [{ src: 'paper.png', decode() { order.push('decode'); return artwork.promise; } }],
    audio: {
      start() { order.push('start'); return audioPlayback.promise; },
      reset() { order.push('reset'); }
    }
  });
  s.ids.envelopeTrigger.dispatchEvent({ type: 'click', detail: 0 });
  assert.deepEqual(order, ['start', 'decode']);
  assert.equal(s.api.state, 'glowing');
  s.ids.envelopeTrigger.dispatchEvent({ type: 'click', detail: 1 });
  assert.deepEqual(order, ['start', 'decode']);
  artwork.resolve();
  await s.flush();
  // An unresolved play promise must not hold up the visual invitation.
  assert.equal(s.api.state, 'invitation');
  assert.deepEqual(order, ['start', 'decode']);
  s.api.reset();
  assert.deepEqual(order, ['start', 'decode', 'reset']);
  assert.equal(s.api.state, 'closed');
  audioPlayback.resolve();
});
