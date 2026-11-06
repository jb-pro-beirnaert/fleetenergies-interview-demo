import type { z } from 'zod';
import {
  DriverMessages,
  FuelBalance,
  FuelTransactions,
  SimilarEvents,
  SimilarEventsInput,
  TankCurve,
  TruckInput,
  TruckProfile,
  TruckWindowInput,
  VehicleActivity,
} from '@fleet/contracts';

type Route = { path: string; query?: Record<string, string | number> };

export type ToolDefinition<I extends z.ZodObject = z.ZodObject> = {
  name: string;
  description: string;
  input: I;
  output: z.ZodObject;
  route: (args: z.infer<I>) => Route;
};

// Le générique vérifie `route` contre le schéma d'entrée, puis on l'efface pour la liste
const tool = <I extends z.ZodObject>(def: ToolDefinition<I>) =>
  def as unknown as ToolDefinition;

const truckPath = (truckId: string, resource: string) =>
  `/agent/trucks/${encodeURIComponent(truckId)}/${resource}`;

const windowRoute =
  (resource: string) =>
  ({ truckId, from, to }: TruckWindowInput): Route => ({
    path: truckPath(truckId, resource),
    query: { from, to },
  });

// Un outil = une route `/agent/trucks/:truckId/*` (spec 05) ; descriptions lues par le modèle
export const TOOLS: ToolDefinition[] = [
  tool({
    name: 'get_truck_profile',
    description:
      "Fiche du camion : capacité du réservoir, énergie, présence d'un groupe frigo, consommation habituelle, notes connues sur la sonde. À appeler en premier pour connaître le contexte.",
    input: TruckInput,
    output: TruckProfile,
    route: ({ truckId }) => ({ path: truckPath(truckId, 'profile') }),
  }),
  tool({
    name: 'get_tank_curve',
    description:
      'Niveau du réservoir sur une période, résumé : niveaux de début et de fin, plus forte chute (moteur coupé ou non), remontées sans plein qui peuvent trahir un artefact de sonde.',
    input: TruckWindowInput,
    output: TankCurve,
    route: windowRoute('tank-curve'),
  }),
  tool({
    name: 'get_vehicle_activity',
    description:
      "Arrêts du camion avec leur durée, l'état du moteur et le type de lieu (station, dépôt, atelier, aire d'autoroute, client). Permet de savoir où et dans quelles conditions la baisse a eu lieu.",
    input: TruckWindowInput,
    output: VehicleActivity,
    route: windowRoute('activity'),
  }),
  tool({
    name: 'find_fuel_transactions',
    description:
      'Pleins enregistrés (cartes carburant et factures) sur une période. Une chute expliquée par un plein mal enregistré ou une facture incohérente se voit ici.',
    input: TruckWindowInput,
    output: FuelTransactions,
    route: windowRoute('fuel-transactions'),
  }),
  tool({
    name: 'read_driver_messages',
    description:
      "Messages libres envoyés par le conducteur sur une période (pseudonymisés). Peut contenir une explication : intervention d'atelier, problème de jauge, transfert vers le groupe frigo.",
    input: TruckWindowInput,
    output: DriverMessages,
    route: windowRoute('driver-messages'),
  }),
  tool({
    name: 'compute_fuel_balance',
    description:
      'Calcul exact du bilan carburant : consommation attendue selon les kilomètres et le ralenti, pleins, baisse observée et litres inexpliqués. Utiliser ce calcul plutôt que d’estimer soi-même.',
    input: TruckWindowInput,
    output: FuelBalance,
    route: windowRoute('fuel-balance'),
  }),
  tool({
    name: 'find_similar_events',
    description:
      'Chutes de niveau comparables du même camion sur les jours précédents, avec l’heure, le lieu et le verdict passé s’il existe. Un motif répété renforce un soupçon.',
    input: SimilarEventsInput,
    output: SimilarEvents,
    route: ({ truckId, lookbackDays }) => ({
      path: truckPath(truckId, 'similar-events'),
      query: { lookbackDays },
    }),
  }),
];
