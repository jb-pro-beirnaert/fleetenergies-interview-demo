import {
  AMBIGUOUS_DRIVER,
  createMasker,
  EMAIL_MASK,
  maskDeep,
  PHONE_MASK,
} from './pii.js';

const mask = createMasker([
  { fullName: 'Hélène Durand', pseudonym: 'C-01' },
  { fullName: 'Jean-Marc Lefèvre', pseudonym: 'C-02' },
  { fullName: 'Marc Durand', pseudonym: 'C-03' },
]);

describe('personal data masking', () => {
  it('replaces a full name with the pseudonym, ignoring case and accents', () => {
    expect(mask('Message from Hélène Durand')).toBe('Message from C-01');
    expect(mask('HELENE DURAND at the depot')).toBe('C-01 at the depot');
    expect(mask('jean-marc lefevre')).toBe('C-02');
  });

  it('replaces a first or last name alone when it is unambiguous', () => {
    expect(mask('Saw Hélène this morning')).toBe('Saw C-01 this morning');
    expect(mask('Lefèvre is on a break')).toBe('C-02 is on a break');
  });

  it('does not pick a pseudonym for a shared name', () => {
    expect(mask('Durand called')).toBe(`${AMBIGUOUS_DRIVER} called`);
  });

  it('leaves alone a word that contains a name', () => {
    expect(mask('Marcy market, Marchmont Street')).toBe('Marcy market, Marchmont Street');
  });

  it.each([
    '06 12 34 56 78',
    '0612345678',
    '+33 6 12 34 56 78',
    '06.12.34.56.78',
    '04-75-12-34-56',
  ])('masks the phone number %s', (phone) => {
    expect(mask(`Call the mechanic on ${phone} tomorrow`)).toBe(
      `Call the mechanic on ${PHONE_MASK} tomorrow`,
    );
  });

  it('masks email addresses', () => {
    expect(mask('write to garage.sud@exemple.fr')).toBe(
      `write to ${EMAIL_MASK}`,
    );
  });

  it('leaves ids, dates and number plates intact', () => {
    const text =
      '2026-10-14T02:35:00.000Z 0f6c1d2e-0612-4345-8678-061234567890 AB-123-CD';
    expect(mask(text)).toBe(text);
  });

  it('maskDeep walks objects and arrays', () => {
    expect(
      maskDeep(
        { a: ['Hélène', 3, null], b: { c: '0612345678', d: true } },
        mask,
      ),
    ).toEqual({ a: ['C-01', 3, null], b: { c: PHONE_MASK, d: true } });
  });
});
