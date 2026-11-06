import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppHeader } from './header/app-header';
import { SimulationBar } from './simulation/simulation-bar';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, AppHeader, SimulationBar],
  template: `
    <app-header />
    <app-simulation-bar />
    <router-outlet />
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100dvh;
    }
  `,
})
export class App {}
