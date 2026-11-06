import type {
  AlertDetail,
  AlertStatus,
  AlertType,
  PlaceType,
  VerdictCategory,
} from '@fleet/contracts';

export const CATEGORY_LABELS: Record<VerdictCategory, string> = {
  theft_suspected: 'Vol probable',
  sensor_fault: 'Défaillance de sonde',
  equipment_transfer: 'Transfert vers équipement',
  legitimate_operation: 'Opération légitime',
  billing_discrepancy: 'Écart de facturation',
  inconclusive: 'Indéterminé',
};

// Ordre d'affichage (histogramme)
export const CATEGORIES = Object.keys(CATEGORY_LABELS) as VerdictCategory[];

export const STATUS_LABELS: Record<AlertStatus, string> = {
  detected: 'Détectée',
  investigating: 'En enquête',
  closed: 'Classée auto',
  escalated: 'Escaladée',
  confirmed: 'Confirmée',
  dismissed: 'Rejetée',
};

export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  fuel_drop: 'Chute de carburant',
};

export const PLACE_TYPE_LABELS: Record<PlaceType, string> = {
  fuel_station: 'Station',
  depot: 'Dépôt',
  workshop: 'Atelier',
  rest_area: 'Aire',
  customer: 'Client',
  other: 'Autre',
};

export const PLACE_TYPE_COLORS: Record<PlaceType, string> = {
  fuel_station: '#2563eb',
  depot: '#475569',
  workshop: '#7c3aed',
  rest_area: '#ea580c',
  customer: '#0d9488',
  other: '#94a3b8',
};

// Phrase lisible pour chaque outil d'enquête
export const TOOL_PHRASES: Record<string, string> = {
  get_truck_profile: 'Consulte la fiche du camion',
  get_tank_curve: 'Consulte la courbe du réservoir',
  get_vehicle_activity: 'Retrace les déplacements et les arrêts',
  find_fuel_transactions: 'Cherche les pleins sur la période',
  read_driver_messages: 'Lit les messages du conducteur',
  compute_fuel_balance: 'Calcule le bilan carburant',
  find_similar_events: 'Cherche des chutes similaires dans l’historique',
};

export const toolPhrase = (toolName: string | null) =>
  (toolName && TOOL_PHRASES[toolName]) ?? `Appelle l’outil ${toolName ?? 'inconnu'}`;

// Catégories toujours escaladées par l'API (spec 03, « Décision après verdict »)
const ALWAYS_ESCALATED: ReadonlySet<VerdictCategory> = new Set([
  'theft_suspected',
  'billing_discrepancy',
  'inconclusive',
]);

/**
 * Raison lisible de la décision de l'API. L'API ne renvoie pas la règle appliquée :
 * on la reconstitue à partir de la catégorie et du motif d'échec éventuel.
 */
export function decisionReason(alert: AlertDetail): string | null {
  const failure = alert.details['failure'];
  if (failure !== undefined && alert.decision !== 'auto_closed') {
    return `Enquête en échec : ${typeof failure === 'string' ? failure : JSON.stringify(failure)}`;
  }
  const category = alert.investigation?.category;
  if (!alert.decision || !category) return null;
  if (alert.decision === 'auto_closed') {
    return 'Catégorie bénigne et confiance au-dessus du seuil d’auto-clôture';
  }
  if (ALWAYS_ESCALATED.has(category)) {
    return `« ${CATEGORY_LABELS[category]} » est toujours revu par un analyste`;
  }
  return 'Confiance sous le seuil d’auto-clôture';
}
