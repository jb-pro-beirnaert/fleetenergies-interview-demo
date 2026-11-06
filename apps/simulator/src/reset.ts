// `simulator reset` : POST /admin/reset (supprime la journée de démo, garde l'historique).

import type { ResetResult } from '@fleet/contracts';
import type { ApiClient } from './api.ts';

export const reset = (api: ApiClient): Promise<ResetResult> =>
  api.post<ResetResult>('/admin/reset', 'admin');
