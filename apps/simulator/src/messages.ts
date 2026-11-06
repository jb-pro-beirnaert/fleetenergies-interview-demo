// Messages banals des conducteurs (spec 04). En V2, le générateur les réécrira.

import type { PlaceType } from '@fleet/contracts';

export const MESSAGE_TEMPLATES: Record<PlaceType | 'driving', readonly string[]> = {
  customer: [
    'Bien arrivé chez le client, on attend le quai.',
    'Livraison terminée chez le client, je repars.',
    'Client en retard pour le déchargement, je patiente.',
    'Arrivé sur site, déchargement en cours.',
    'Le client demande de revenir avec deux palettes de plus la prochaine fois.',
  ],
  depot: [
    'Je prends mon poste, camion OK.',
    'Chargement terminé, je pars.',
    'De retour au dépôt, fin de tournée.',
    'Les papiers de la tournée sont dans la bannette.',
  ],
  rest_area: [
    'Pause réglementaire sur l’aire.',
    'Je fais ma pause, je repars dans 45 minutes.',
  ],
  fuel_station: ['Arrêt rapide à la station, je repars.'],
  workshop: ['Passage à l’atelier pour le contrôle prévu.'],
  other: ['Arrêté quelques minutes, tout va bien.'],
  driving: [
    'Bouchons sur l’A7, j’aurai du retard.',
    'Circulation dense, j’arrive un peu plus tard que prévu.',
    'Ralentissements à cause de travaux, je vous tiens au courant.',
    'Je suis en route, tout va bien.',
    'Bouchons à Lyon, prévoir 20 minutes de retard.',
  ],
};
