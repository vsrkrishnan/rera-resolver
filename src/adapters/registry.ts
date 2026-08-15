import type { StateCode } from '../types.js';
import type { StateAdapter } from './types.js';
import { karnatakaAdapter } from './karnataka.js';
import { tamilNaduAdapter } from './tamilnadu.js';

// The one place that knows which states are supported. Adding a state = write
// its adapter, add it here. Unimplemented states are declared but undefined so
// getAdapter gives a clear error rather than a silent wrong-registry crawl.
const ADAPTERS: Record<StateCode, StateAdapter | undefined> = {
  KA: karnatakaAdapter,
  TN: tamilNaduAdapter,
  MH: undefined, // Maharashtra — planned
};

export const SUPPORTED_STATES: StateCode[] = (Object.keys(ADAPTERS) as StateCode[]).filter(
  (code) => ADAPTERS[code] !== undefined,
);

export function getAdapter(state: StateCode): StateAdapter {
  const adapter = ADAPTERS[state];
  if (!adapter) {
    throw new Error(
      `No RERA adapter for state "${state}". Supported states: ${SUPPORTED_STATES.join(', ')}.`,
    );
  }
  return adapter;
}
