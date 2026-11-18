import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeSlots, checkSlot, nowLocal, addDays, weekday, waToLocal, horairesTexte } from '../src/slots.js';
import { PROFILE } from './helpers.js';

// Lundi 23 novembre 2026, 08:00 heure d'Algérie (07:00 UTC)
const NOW = Date.parse('2026-11-23T07:00:00Z');

test('heure locale Algérie = UTC+1', () => {
  assert.deepEqual(nowLocal(NOW), { date: '2026-11-23', min: 8 * 60, wd: 1 });
  assert.equal(nowLocal(Date.parse('2026-11-23T23:30:00Z')).date, '2026-11-24');
});

test('créneaux dans les horaires, 4 par jour max, vendredi fermé', () => {
  const s = freeSlots(PROFILE, [], '2026-11-23', '2026-11-29', { nowMs: NOW, limit: 50 });
  assert.ok(s.length > 0);
  assert.ok(!s.some((x) => weekday(x.date) === 5), 'aucun créneau le vendredi');
  const lundi = s.filter((x) => x.date === '2026-11-23').map((x) => x.heure);
  // délai minimal de 2 h : à 8:00, premier créneau possible 10:00
  assert.deepEqual(lundi, ['10:00', '10:30', '11:00', '11:30']);
});

test('les rendez-vous existants bloquent les créneaux', () => {
  const busy = [{ d: '2026-11-24', h: '09:00', m: 60 }, { d: '2026-11-24', h: '10:15', m: 30 }];
  const mardi = freeSlots(PROFILE, busy, '2026-11-24', '2026-11-24', { nowMs: NOW, perDay: 10 }).map((x) => x.heure);
  assert.deepEqual(mardi, ['11:00', '11:30']);
});

test('matin / après-midi', () => {
  const am = freeSlots(PROFILE, [], '2026-11-29', '2026-11-29', { nowMs: NOW, moment: 'apres-midi', perDay: 10 }).map((x) => x.heure);
  assert.equal(am[0], '14:00');
});

test('fermetures exceptionnelles', () => {
  const p = { ...PROFILE, conges: [['2026-11-24', '2026-11-26']] };
  const s = freeSlots(p, [], '2026-11-24', '2026-11-26', { nowMs: NOW });
  assert.equal(s.length, 0);
  assert.match(checkSlot(p, [], '2026-11-25', '09:00', { nowMs: NOW }), /fermé/);
});

test('vérification d’un créneau précis', () => {
  const busy = [{ d: '2026-11-24', h: '09:00', m: 30 }];
  assert.equal(checkSlot(PROFILE, busy, '2026-11-24', '09:30', { nowMs: NOW }), '');
  assert.match(checkSlot(PROFILE, busy, '2026-11-24', '09:00', { nowMs: NOW }), /déjà pris/);
  assert.match(checkSlot(PROFILE, busy, '2026-11-24', '11:45', { nowMs: NOW }), /horaires/);
  assert.match(checkSlot(PROFILE, busy, '2026-11-27', '10:00', { nowMs: NOW }), /fermé/);
  assert.match(checkSlot(PROFILE, busy, '2026-11-23', '08:30', { nowMs: NOW }), /passé|proche/);
  assert.match(checkSlot(PROFILE, busy, addDays('2026-11-23', 40), '09:00', { nowMs: NOW }), /lointaine/);
});

test('numéros et horaires lisibles', () => {
  assert.equal(waToLocal('213555123456'), '0555123456');
  assert.equal(waToLocal('33612345678'), '+33612345678');
  assert.match(horairesTexte(PROFILE), /^samedi : 09:00-13:00/);
  assert.match(horairesTexte(PROFILE), /vendredi : fermé/);
});
