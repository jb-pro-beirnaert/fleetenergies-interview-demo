import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppHeader } from './header/app-header';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, AppHeader],
  template: `
    <app-header />
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
