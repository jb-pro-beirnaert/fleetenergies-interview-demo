import { Routes } from '@angular/router';
import { ControlRoom } from './control-room';

export const routes: Routes = [
  // No route `title`: the tab title follows the language (`syncDocument` in core/i18n/i18n.ts)
  { path: '', component: ControlRoom },
  { path: 'fleet', loadComponent: () => import('./fleet/fleet-page').then((m) => m.FleetPage) },
  {
    path: 'invoices',
    loadComponent: () => import('./invoices/invoices-page').then((m) => m.InvoicesPage),
  },
  { path: '**', redirectTo: '' },
];
