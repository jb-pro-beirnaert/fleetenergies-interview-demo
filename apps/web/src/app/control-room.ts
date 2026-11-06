import { Component } from '@angular/core';
import { AlertFeed } from './feed/alert-feed';
import { InvestigationPanel } from './investigation/investigation-panel';
import { ValuePanel } from './value/value-panel';

@Component({
  selector: 'app-control-room',
  imports: [AlertFeed, InvestigationPanel, ValuePanel],
  template: `
    <app-alert-feed class="column" />
    <app-investigation-panel class="column center" />
    <app-value-panel class="column" />
  `,
  styles: `
    :host {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: 340px minmax(0, 1fr) 300px;
    }
    .column {
      min-height: 0;
      overflow-y: auto;
    }
    .center {
      border-left: 1px solid var(--border);
      border-right: 1px solid var(--border);
      background: var(--bg);
    }
  `,
})
export class ControlRoom {}
