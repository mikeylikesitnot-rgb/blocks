import { describe, expect, it } from 'vitest';
import { botReason, contentReason, hasLink, isFakePhone, isSalesPitch, pitchGroups, spamCheck, SPAM_PHRASES } from '../server/spam.js';

const ANGELA = 'Hey, are you guys still selling used cars? My partner thought of a good idea where we might have a lot of synergy. '
  + 'There is a private group that is opening up some of their regulations to help with some backing of car dealers. '
  + 'It would be better to talk before Thanksgiving. Who\'s the right person to talk to about it? Talk soon.';

const WHITMORE = 'Hi, I came across your business and think there could be a strong partnership. Whitmore Data Partners pays businesses '
  + 'per accepted hour for anonymized work data. Would you be open to a quick call? If it\'s not a fit, just reply STOP.';

const CUSTOMERS = [
  'Is the 2013 F-150 still available? I would like to come see it Saturday. What is the best price?',
  'I need financing, my credit is not great. Can I get pre-qualified before I come in?',
  'Can we hop on a quick call about the Silverado? Here is my number.',
  'My partner and I want to test drive the Infiniti QX50 this weekend.',
  'Who is the right person to talk to about a trade-in?',
  'Do you take trade ins? I have a 2010 Camry with 150k miles. Down payment around $2000.',
  'I own a small business and need a work truck, budget about $400 per month.',
  "If it's not a good fit I'll keep looking. I'm pre-approved with a private lender.",
];

describe('isSalesPitch', () => {
  it('catches the Whitmore and New York Savings pitches', () => {
    expect(isSalesPitch(WHITMORE)).toBe(true);
    expect(isSalesPitch(ANGELA)).toBe(true);
    expect(pitchGroups(ANGELA)).toEqual(['money', 'intro']);
  });
  it('lets ordinary customer messages through', () => {
    for (const m of CUSTOMERS) expect(isSalesPitch(m), m).toBe(false);
  });
  it('needs a strong group: two weak groups are not enough', () => {
    expect(isSalesPitch('Is AI part of it? Who is the right person to talk to?')).toBe(false);
  });
  it('matches AI only in capitals', () => {
    expect(pitchGroups('our AI tool')).toEqual(['ai']);
    expect(pitchGroups('said hi to Ai')).toEqual([]);
  });
  it('every pattern compiles and the strong list names real groups', () => {
    for (const g of SPAM_PHRASES.strong) expect(SPAM_PHRASES.groups[g]).toBeTruthy();
  });
});

describe('isFakePhone', () => {
  it('flags 555-0100..0199 in any format', () => {
    for (const p of ['555-0123', '(214) 555-0199', '+1 972 555 0100', '2145550150']) expect(isFakePhone(p), p).toBe(true);
    for (const p of ['214-555-0200', '214-555-1234', '', null]) expect(isFakePhone(p), String(p)).toBe(false);
  });
});

describe('hasLink', () => {
  it('finds links, bbcode and anchors', () => {
    expect(hasLink('see https://cheap.example')).toBe(true);
    expect(hasLink('go to www.spam.biz now')).toBe(true);
    expect(hasLink('[url=x]hi[/url]')).toBe(true);
    expect(hasLink('<a href="x">x</a>')).toBe(true);
    expect(hasLink('no link here, call 214-555-1234')).toBe(false);
  });
  it('lets links to allowed hosts through', () => {
    const o = { allowHosts: ['nextgencarstrucks.com'] };
    expect(hasLink('is https://www.nextgencarstrucks.com/inventory/1 still there?', o)).toBe(false);
    expect(hasLink('https://nextgencarstrucks.com.evil.io', o)).toBe(true);
    expect(hasLink('https://nextgencarstrucks.com and https://evil.io', o)).toBe(true);
    for (const t of ['Saw www.nextgencarstrucks.com.', '(https://nextgencarstrucks.com)', 'on nextgencarstrucks.com, https://nextgencarstrucks.com/x, thanks']) expect(hasLink(t, o), t).toBe(false);
    expect(hasLink('see https://evil.io.', o)).toBe(true);
  });
});

describe('botReason', () => {
  it('honeypot, no timing, too fast, ok', () => {
    expect(botReason({ honeypot: 'x', elapsedMs: 9000 })).toBe('honeypot');
    expect(botReason({})).toBe('no-timing');
    expect(botReason({ elapsedMs: 'abc' })).toBe('no-timing');
    expect(botReason({ elapsedMs: 1200 })).toBe('too-fast');
    expect(botReason({ elapsedMs: '4000' })).toBe(null);
    expect(botReason({ elapsedMs: 1200 }, { minMs: 1000 })).toBe(null);
  });
});

describe('contentReason / spamCheck', () => {
  it('names the first content reason', () => {
    expect(contentReason({ phone: '555-0101', message: 'hi' })).toBe('fake-phone');
    expect(contentReason({ name: 'Bob www.x.io', message: 'hi' })).toBe('link');
    expect(contentReason({ message: ANGELA })).toBe('sales-pitch');
    expect(contentReason({ phone: '214-555-1234', message: CUSTOMERS[0] })).toBe(null);
  });
  it('checks bots first and reports the groups hit', () => {
    expect(spamCheck({ elapsedMs: 100, message: ANGELA })).toEqual({ reason: 'too-fast', groups: ['money', 'intro'] });
    expect(spamCheck({ elapsedMs: 8000, message: ANGELA })).toEqual({ reason: 'sales-pitch', groups: ['money', 'intro'] });
    expect(spamCheck({ elapsedMs: 8000, message: CUSTOMERS[1] })).toBe(null);
  });
});
