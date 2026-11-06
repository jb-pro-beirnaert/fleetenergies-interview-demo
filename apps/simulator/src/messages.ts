// Everyday driver messages (spec 04). In V2, the generator will rewrite them.

import type { PlaceType } from '@fleet/contracts';

export const MESSAGE_TEMPLATES: Record<PlaceType | 'driving', readonly string[]> = {
  customer: [
    'Arrived at the customer, waiting for a loading bay.',
    'Delivery done at the customer, heading off again.',
    'Customer late for unloading, waiting.',
    'On site, unloading in progress.',
    'The customer asks to bring two more pallets next time.',
  ],
  depot: [
    'Starting my shift, truck OK.',
    'Loading done, leaving now.',
    'Back at the depot, end of round.',
    'The round paperwork is in the tray.',
  ],
  rest_area: [
    'Mandatory break at the rest area.',
    'Taking my break, back on the road in 45 minutes.',
  ],
  fuel_station: ['Quick stop at the station, heading off again.'],
  workshop: ['Stopping at the workshop for the scheduled check.'],
  other: ['Stopped for a few minutes, all good.'],
  driving: [
    'Traffic jams on the A7, I will be late.',
    'Heavy traffic, arriving a bit later than planned.',
    'Slowdowns because of roadworks, I will keep you posted.',
    'On my way, all good.',
    'Traffic jams in Lyon, expect a 20-minute delay.',
  ],
};
