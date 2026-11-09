import { z } from 'zod';
import { TaskType } from './enums.ts';

export const ClaimRequest = z
  .object({ type: TaskType, workerId: z.string().min(1).max(200) })
  .meta({ id: 'ClaimRequest' });
export type ClaimRequest = z.infer<typeof ClaimRequest>;

export const InvestigateAlertPayload = z.object({ alertId: z.uuid() });
export type InvestigateAlertPayload = z.infer<typeof InvestigateAlertPayload>;

export const ExtractInvoicePayload = z.object({ invoiceId: z.uuid() });
export type ExtractInvoicePayload = z.infer<typeof ExtractInvoicePayload>;

export const ClaimedTask = z
  .object({
    id: z.uuid(),
    type: TaskType,
    // `investigate_alert` → { alertId }; `extract_invoice` → { invoiceId }
    payload: z.union([InvestigateAlertPayload, ExtractInvoicePayload]),
    attempts: z.int(),
  })
  .meta({ id: 'ClaimedTask' });
export type ClaimedTask = z.infer<typeof ClaimedTask>;

// `workerId`: only the worker holding the lock can complete or fail the task (409 otherwise)
export const CompleteRequest = z
  .object({ workerId: z.string().min(1).max(200) })
  .meta({ id: 'CompleteRequest' });
export type CompleteRequest = z.infer<typeof CompleteRequest>;

export const FailRequest = z
  .object({
    workerId: z.string().min(1).max(200),
    error: z.string().min(1).max(4000),
    retryable: z.boolean(),
  })
  .meta({ id: 'FailRequest' });
export type FailRequest = z.infer<typeof FailRequest>;
