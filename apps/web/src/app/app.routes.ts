import { Routes } from '@angular/router';
import { ControlRoom } from './control-room';

export const routes: Routes = [
  // No route `title`: the tab title follows the language (`syncDocument` in core/i18n/i18n.ts)
  { path: '', component: ControlRoom },
  { path: '**', redirectTo: '' },
];
