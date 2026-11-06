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

// The generic checks `route` against the input schema, then it is erased for the list
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

// One tool = one `/agent/trucks/:truckId/*` route (spec 05); descriptions are read by the model
export const TOOLS: ToolDefinition[] = [
  tool({
    name: 'get_truck_profile',
    description:
      'Truck profile: tank capacity, energy, whether it has a reefer unit, usual consumption, known notes about the fuel sensor. Call it first to get the context.',
    input: TruckInput,
    output: TruckProfile,
    route: ({ truckId }) => ({ path: truckPath(truckId, 'profile') }),
  }),
  tool({
    name: 'get_tank_curve',
    description:
      'Tank level over a period, summarised: start and end levels, biggest drop (engine off or not), rises without a refuel that may betray a sensor artefact.',
    input: TruckWindowInput,
    output: TankCurve,
    route: windowRoute('tank-curve'),
  }),
  tool({
    name: 'get_vehicle_activity',
    description:
      'Truck stops with their duration, engine state and place type (fuel station, depot, workshop, motorway rest area, customer). Shows where and under which conditions the decrease happened.',
    input: TruckWindowInput,
    output: VehicleActivity,
    route: windowRoute('activity'),
  }),
  tool({
    name: 'find_fuel_transactions',
    description:
      'Recorded refuels (fuel cards and invoices) over a period. A drop explained by a badly recorded refuel or an inconsistent invoice shows up here.',
    input: TruckWindowInput,
    output: FuelTransactions,
    route: windowRoute('fuel-transactions'),
  }),
  tool({
    name: 'read_driver_messages',
    description:
      'Free-text messages sent by the driver over a period (pseudonymised). May contain an explanation: workshop job, gauge problem, transfer to the reefer unit.',
    input: TruckWindowInput,
    output: DriverMessages,
    route: windowRoute('driver-messages'),
  }),
  tool({
    name: 'compute_fuel_balance',
    description:
      'Exact fuel balance calculation: expected consumption from kilometres and idling, refuels, observed decrease and unexplained liters. Use this calculation rather than estimating yourself.',
    input: TruckWindowInput,
    output: FuelBalance,
    route: windowRoute('fuel-balance'),
  }),
  tool({
    name: 'find_similar_events',
    description:
      'Comparable level drops of the same truck over the previous days, with the time, the place and the past verdict if any. A repeated pattern strengthens a suspicion.',
    input: SimilarEventsInput,
    output: SimilarEvents,
    route: ({ truckId, lookbackDays }) => ({
      path: truckPath(truckId, 'similar-events'),
      query: { lookbackDays },
    }),
  }),
];
