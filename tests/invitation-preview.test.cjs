const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'invitation.js'), 'utf8');

function setup({ embedded = true } = {}) {
  const messages = [];
  const listeners = new Map();
  let frames = 0;
  let intervals = 0;
  const element = () => {
    const classes = new Set();
    return {
      classList: {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
        contains(name) { return classes.has(name); }
      }
    };
  };
  const reveal = element();
  let replayClick;
  const replay = { addEventListener(name, callback) { if (name === 'click') replayClick = callback; } };
  const document = {
    body: element(), documentElement: element(),
    getElementById() { return null; },
    querySelector(selector) { return selector === '.replay-link' ? replay : null; },
    querySelectorAll(selector) { return selector === '.reveal' ? [reveal] : []; }
  };
  const window = {
    WEDDING: { date: '2099-10-01', startTime: '16:00', utcOffset: '+03:00' },
    matchMedia() { return { matches: true, addEventListener() {} }; },
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(callback);
    },
    requestAnimationFrame(callback) { frames++; callback(); },
    setInterval() { return ++intervals; },
    clearInterval() {}
  };
  window.self = window;
  window.top = embedded ? {} : window;
  window.parent = embedded ? { postMessage(data, origin) { messages.push({ type: data.type, origin }); } } : window;
  vm.runInNewContext(source, { window, document, URL }, { filename: 'invitation.js' });
  return {
    window, document, reveal, messages,
    get frames() { return frames; },
    get intervals() { return intervals; },
    message(type, sender = window.parent) {
      for (const callback of listeners.get('message') || []) callback({ source: sender, data: { type } });
    },
    replay() {
      let prevented = false;
      replayClick({ preventDefault() { prevented = true; } });
      return prevented;
    }
  };
}

test('the invitation preview waits for its parent before starting the introduction and countdown', () => {
  const s = setup();
  assert.equal(s.document.body.classList.contains('is-preview'), true);
  assert.equal(s.document.body.classList.contains('intro-ready'), false);
  assert.equal(s.reveal.classList.contains('is-visible'), false);
  assert.equal(s.frames, 0);
  assert.equal(s.intervals, 0);
  assert.deepEqual(s.messages, [{ type: 'invitation:ready', origin: '*' }]);
  s.message('invitation:activate', {});
  s.message('unrelated');
  assert.equal(s.frames, 0);
  assert.equal(s.document.body.classList.contains('is-preview'), true);
  s.message('invitation:activate');
  assert.equal(s.document.body.classList.contains('is-preview'), false);
  assert.equal(s.document.body.classList.contains('intro-ready'), true);
  assert.equal(s.reveal.classList.contains('is-visible'), true);
  assert.equal(s.frames, 2);
  assert.equal(s.intervals, 1);
  s.message('invitation:activate');
  assert.equal(s.frames, 2);
  assert.equal(s.intervals, 1);
  assert.equal(s.replay(), true);
  assert.deepEqual(s.messages.at(-1), { type: 'invitation:replay', origin: '*' });
});

test('opening the invitation directly starts immediately and retains its native replay link', () => {
  const s = setup({ embedded: false });
  assert.equal(s.document.body.classList.contains('is-preview'), false);
  assert.equal(s.document.body.classList.contains('intro-ready'), true);
  assert.equal(s.reveal.classList.contains('is-visible'), true);
  assert.equal(s.frames, 2);
  assert.equal(s.intervals, 1);
  assert.deepEqual(s.messages, []);
  assert.equal(s.replay(), false);
  s.message('invitation:activate');
  assert.equal(s.frames, 2);
  assert.equal(s.intervals, 1);
});
