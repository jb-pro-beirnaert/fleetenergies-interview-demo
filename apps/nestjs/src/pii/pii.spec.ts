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

describe('masquage des données personnelles', () => {
  it('remplace un nom complet par le pseudonyme, sans tenir compte de la casse ni des accents', () => {
    expect(mask('Message de Hélène Durand')).toBe('Message de C-01');
    expect(mask('HELENE DURAND au dépôt')).toBe('C-01 au dépôt');
    expect(mask('jean-marc lefevre')).toBe('C-02');
  });

  it('remplace un prénom ou un nom seul quand il est univoque', () => {
    expect(mask('Vu avec Hélène ce matin')).toBe('Vu avec C-01 ce matin');
    expect(mask('Lefèvre est en pause')).toBe('C-02 est en pause');
  });

  it('ne choisit pas de pseudonyme pour un nom partagé', () => {
    expect(mask('Durand a appelé')).toBe(`${AMBIGUOUS_DRIVER} a appelé`);
  });

  it('ne touche pas un mot qui contient un nom', () => {
    expect(mask('Marché de Marcy')).toBe('Marché de Marcy');
  });

  it.each([
    '06 12 34 56 78',
    '0612345678',
    '+33 6 12 34 56 78',
    '06.12.34.56.78',
    '04-75-12-34-56',
  ])('masque le téléphone %s', (phone) => {
    expect(mask(`Appeler le mécanicien au ${phone} demain`)).toBe(
      `Appeler le mécanicien au ${PHONE_MASK} demain`,
    );
  });

  it('masque les e-mails', () => {
    expect(mask('écrire à garage.sud@exemple.fr')).toBe(
      `écrire à ${EMAIL_MASK}`,
    );
  });

  it('laisse intacts identifiants, dates et immatriculations', () => {
    const text =
      '2026-10-14T02:35:00.000Z 0f6c1d2e-0612-4345-8678-061234567890 AB-123-CD';
    expect(mask(text)).toBe(text);
  });

  it('maskDeep parcourt objets et tableaux', () => {
    expect(
      maskDeep(
        { a: ['Hélène', 3, null], b: { c: '0612345678', d: true } },
        mask,
      ),
    ).toEqual({ a: ['C-01', 3, null], b: { c: PHONE_MASK, d: true } });
  });
});
