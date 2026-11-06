// THE CONTACT CARD in the modern offer's QR code (user decision 2026-11-06, stage 2): the company and the offer's
// handler as a vCard 3.0 (every phone's camera offers „add contact”), kept compact — no TYPE parameters, the www as
// written (a full card with the address and those was ~230 bytes, a version-10 code holds 213). When it is still too
// long: the vCard without the address, then the shorter MECARD without the address, then that without the www. Pure.

import { qrCapacityBytes, QR_MAX_VERSION, utf8Bytes } from '../util/qrCode.js';

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const phone = (s) => clean(s).replace(/[^\d+]/g, '');
const vEsc = (s) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,');
// (':' is left as it is — readers differ on '\:')
const meEsc = (s) => s.replace(/([\\;,"])/g, '\\$1');

/** {first, last} of "Anna Nowak" (the last word = the surname). */
function splitName(name) {
  const parts = clean(name).split(' ').filter(Boolean);
  if (!parts.length) return { first: '', last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

/** The contact's fields from the company data (+ its handler of the offer). */
export function contactFields(company = {}) {
  const c = company || {};
  return {
    person: clean(c.contactName),
    org: clean(c.name),
    phones: [phone(c.contactPhone), phone(c.phone)].filter((p, i, a) => p && a.indexOf(p) === i),
    email: clean(c.contactEmail) || clean(c.email),
    www: clean(c.www),
    address: clean(c.address),
  };
}

function vCard(f, { address = true } = {}) {
  const { first, last } = splitName(f.person);
  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  lines.push(f.person ? `N:${vEsc(last)};${vEsc(first)};;;` : 'N:;;;;', `FN:${vEsc(f.person || f.org)}`);
  if (f.org) lines.push(`ORG:${vEsc(f.org)}`);
  for (const p of f.phones) lines.push(`TEL:${p}`);
  if (f.email) lines.push(`EMAIL:${vEsc(f.email)}`);
  if (f.www) lines.push(`URL:${f.www}`);
  if (address && f.address) lines.push(`ADR:;;${vEsc(f.address)};;;;`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

function meCard(f, { www = true } = {}) {
  const { first, last } = splitName(f.person);
  const parts = [`N:${f.person ? `${meEsc(last)},${meEsc(first)}` : meEsc(f.org)}`];
  if (f.person && f.org) parts.push(`ORG:${meEsc(f.org)}`);
  for (const p of f.phones) parts.push(`TEL:${p}`);
  if (f.email) parts.push(`EMAIL:${meEsc(f.email)}`);
  if (www && f.www) parts.push(`URL:${meEsc(f.www)}`);
  return `MECARD:${parts.join(';')};;`;
}

/**
 * The text to put in the QR code: the fullest card that fits a version-10 level-M code.
 * @returns {{text: string, format: 'vcard'|'mecard', dropped: string[]}|null} null = nothing to call or write to
 */
export function contactCardText(company) {
  const f = contactFields(company);
  if (!f.phones.length && !f.email) return null;
  const max = qrCapacityBytes(QR_MAX_VERSION);
  const tries = [
    ['vcard', vCard(f), []],
    ['vcard', vCard(f, { address: false }), ['adres']],
    ['mecard', meCard(f), ['adres']],
    ['mecard', meCard(f, { www: false }), ['adres', 'www']],
  ];
  for (const [format, text, dropped] of tries) if (utf8Bytes(text).length <= max) return { text, format, dropped };
  return null;
}
