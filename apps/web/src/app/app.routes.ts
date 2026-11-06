import { Routes } from '@angular/router';
import { ControlRoom } from './control-room';

export const routes: Routes = [
  { path: '', component: ControlRoom, title: 'Fleet Copilot · Alertes' },
  { path: '**', redirectTo: '' },
];
