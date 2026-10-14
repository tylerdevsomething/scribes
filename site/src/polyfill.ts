// Solana libraries expect Node's Buffer, some of them while they load. This module is imported first.
import { Buffer } from 'buffer';

(globalThis as unknown as { Buffer: typeof Buffer }).Buffer ??= Buffer;
