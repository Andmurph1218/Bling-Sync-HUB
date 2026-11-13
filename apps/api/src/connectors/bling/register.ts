import { registerErpConnector } from '../strategy/factory.js';
import { registerErpSlotAcquirer, registerRateLimiter } from '../rate-limit-port.js';
import { registerCatalogMapper } from '../../orchestrator/erp-port.js';
import { registerPushPort } from '../../orchestrator/push-port.js';
import { BlingErpConnector } from './bling-erp.js';
import { acquireBlingRequestSlot } from './bling-http-limit.js';
import { mapBlingProductToCatalog } from './mappers.js';
import { enqueueOrPromotePushJob, executePushJobById, ExecutePushJobOptions } from './ape.js';
import { sharedBlingRateLimiter } from './rate-limiter.js';
import type { BlingProductPayload } from './fixtures.js';

registerErpConnector('bling', () => new BlingErpConnector());
registerCatalogMapper((payload) => mapBlingProductToCatalog(payload as BlingProductPayload));
registerPushPort({
  enqueueOrPromotePushJob,
  executePushJobById: (id, hooks) => executePushJobById(id, hooks as ExecutePushJobOptions | undefined),
});
registerRateLimiter(sharedBlingRateLimiter);
registerErpSlotAcquirer(acquireBlingRequestSlot);
