const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSchedule, eventTimestamp, countdownParts, normalizePhone, mapUrl, composeRsvp } = require('../invitation.js');

test('the invitation uses the supplied wedding date and local 16:00–19:00 schedule', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../wedding-config.js'), 'utf8'), context);
  const wedding = context.window.WEDDING;
  assert.equal(eventTimestamp(wedding.date, wedding.startTime, wedding.utcOffset), Date.parse('2026-10-01T13:00:00Z'));
  const events = buildSchedule(wedding.startTime);
  assert.equal(events[0].start, 16 * 60);
  assert.equal(events.at(-1).end, 19 * 60);
});

test('all eight events are contiguous and last exactly three hours, including midnight', () => {
  for (const start of ['16:00', '19:00', '23:00']) {
    const events = buildSchedule(start);
    assert.equal(events.length, 8);
    assert.equal(events.at(-1).end - events[0].start, 180);
    events.slice(1).forEach((event, index) => assert.equal(event.start, events[index].end));
  }
  assert.deepEqual(buildSchedule('25:00'), []);
});

test('countdown has no invented date and respects the configured venue timezone', () => {
  assert.equal(eventTimestamp(null, '19:00', '+03:00'), null);
  assert.equal(eventTimestamp('2026-02-30', '19:00', '+03:00'), null);
  assert.equal(eventTimestamp('2026-09-24', '19:00', '+15:00'), null);
  const target = eventTimestamp('2026-09-24', '19:00', '+03:00');
  assert.equal(target, Date.parse('2026-09-24T16:00:00Z'));
  assert.equal(countdownParts(null, Date.now()), null);
  assert.deepEqual(countdownParts(target, target - 90061000), { days: 1, hours: 1, minutes: 1, seconds: 1, finished: false });
  assert.deepEqual(countdownParts(target, target + 1000), { days: 0, hours: 0, minutes: 0, seconds: 0, finished: true });
});

test('RSVP preserves the personal message and refuses invalid guest counts', () => {
  const wedding = { bride: 'ليلى', groom: 'أحمد' };
  const values = { guestName: '  نور  ', attendance: 'yes', guestCount: '3', message: 'ألف مبروك 🤍' };
  const message = composeRsvp(values, wedding);
  assert.match(message, /الاسم: نور\n/);
  assert.match(message, /٣/);
  assert.match(message, /ألف مبروك 🤍/);
  for (const count of ['0', '11', '1.5', 'abc']) assert.throws(() => composeRsvp({ ...values, guestCount: count }, wedding));
  assert.throws(() => composeRsvp({ ...values, guestName: ' ' }, wedding));
  assert.throws(() => composeRsvp({ ...values, attendance: 'unknown' }, wedding));
  assert.doesNotMatch(composeRsvp({ ...values, attendance: 'no', guestCount: '' }, wedding), /عدد الحضور/);
});

test('external RSVP and map links are limited to valid destinations', () => {
  assert.equal(normalizePhone(''), '');
  assert.equal(normalizePhone('+963 999 123 456'), '963999123456');
  assert.equal(normalizePhone('javascript:alert(1)'), '');
  assert.equal(normalizePhone('00963999123456'), '');
  assert.equal(mapUrl('https://maps.app.goo.gl/example'), 'https://maps.app.goo.gl/example');
  for (const url of ['javascript:alert(1)', 'http://maps.google.com', 'https://example.com', 'https://maps.google.com@evil.com', 'https://google.com.evil.com']) assert.equal(mapUrl(url), '');
});
