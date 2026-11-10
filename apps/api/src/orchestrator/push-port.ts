export interface PushChannelCall {
  step: string;
  platform: 'mercadolivre' | 'nuvemshop';
  endpoint: string;
  method: string;
  payload: Record<string, unknown>;
}

export interface PushJobReport {
  finalJobStatus: string;
  executedCalls: Array<{ step: string }>;
}

export interface PushPort {
  enqueueOrPromotePushJob(input: {
    masterProductId: string;
    variantId: string;
    platform: 'mercadolivre' | 'nuvemshop';
    jobKind: 'STOCK_PRICE' | 'CONTENT' | 'CREATE';
    priority: 'P1' | 'P2' | 'P3' | 'P4';
    changedFields: string[];
  }): Promise<{ pushJobId: string; promotedExisting: boolean }>;
  executePushJobById(
    pushJobId: string,
    hooks?: {
      onExecuteChannelCall?: (call: PushChannelCall) => Promise<void> | void;
    }
  ): Promise<PushJobReport>;
}

let port: PushPort | null = null;

export function registerPushPort(next: PushPort): void {
  port = next;
}

export function pushPort(): PushPort {
  if (!port) throw new Error('push_port_not_loaded');
  return port;
}
