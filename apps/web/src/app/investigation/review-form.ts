import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import type { AlertDetail, ReviewDecision } from '@fleet/contracts';
import { ControlRoomStore } from '../core/control-room.store';
import { fmtDateTime } from '../core/format';

@Component({
  selector: 'app-review-form',
  template: `
    <section class="card">
      <h2>Revue humaine</h2>
      @if (alert().review; as review) {
        <p class="done" [attr.data-decision]="review.decision">
          <strong>{{
            review.decision === 'confirm' ? 'Verdict confirmé' : 'Verdict rejeté'
          }}</strong>
          le {{ fmtDateTime(review.reviewedAt) }}
        </p>
        @if (review.comment) {
          <blockquote>{{ review.comment }}</blockquote>
        }
      } @else {
        <textarea
          rows="2"
          maxlength="2000"
          placeholder="Commentaire (facultatif)"
          [value]="comment()"
          (input)="comment.set($any($event.target).value)"
          [disabled]="busy()"
        ></textarea>
        <div class="actions">
          <button type="button" class="confirm" [disabled]="busy()" (click)="submit('confirm')">
            Confirmer
          </button>
          <button type="button" class="dismiss" [disabled]="busy()" (click)="submit('dismiss')">
            Rejeter
          </button>
          @if (error(); as e) {
            <span class="error">{{ e }}</span>
          }
        </div>
      }
    </section>
  `,
  styles: `
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 18px;
    }
    h2 {
      margin: 0 0 10px;
    }
    textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 8px 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      resize: vertical;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 10px;
    }
    .actions button {
      padding: 8px 20px;
      border-radius: 8px;
      font-weight: 700;
      border: 1px solid transparent;
    }
    .confirm {
      background: var(--accent);
      color: white;
    }
    .dismiss {
      background: var(--surface);
      border-color: var(--border) !important;
      color: var(--text);
    }
    button:disabled {
      opacity: 0.5;
      cursor: wait;
    }
    .error {
      color: var(--red);
    }
    .done {
      margin: 0;
    }
    .done[data-decision='confirm'] strong {
      color: var(--green);
    }
    .done[data-decision='dismiss'] strong {
      color: var(--orange);
    }
    blockquote {
      margin: 8px 0 0;
      padding-left: 12px;
      border-left: 3px solid var(--border);
      color: var(--muted);
    }
  `,
})
export class ReviewForm {
  private readonly store = inject(ControlRoomStore);
  readonly alert = input.required<AlertDetail>();

  protected readonly comment = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly fmtDateTime = fmtDateTime;

  constructor() {
    // changement d'alerte : formulaire vierge
    let lastId: string | null = null;
    effect(() => {
      const id = this.alert().id;
      if (id !== lastId) {
        lastId = id;
        untracked(() => {
          this.comment.set('');
          this.error.set(null);
        });
      }
    });
  }

  protected async submit(decision: ReviewDecision) {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.store.review(this.alert().id, decision, this.comment());
    } catch (err) {
      this.error.set(
        err instanceof HttpErrorResponse && err.status === 409
          ? 'Cette alerte a déjà été revue ou ne peut pas l’être.'
          : 'La revue n’a pas pu être enregistrée.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
