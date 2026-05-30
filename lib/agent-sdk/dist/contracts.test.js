import { describe, it, expect } from 'vitest';
import { walletLinkDeadline, MAX_DEADLINE_SECONDS } from './contracts.js';
describe('walletLinkDeadline', () => {
    it('default offset returns deadline within contract MAX_DEADLINE_DELAY (300s)', () => {
        const now = Math.floor(Date.now() / 1000);
        const deadline = Number(walletLinkDeadline());
        const offset = deadline - now;
        expect(offset).toBeGreaterThan(0);
        expect(offset).toBeLessThanOrEqual(MAX_DEADLINE_SECONDS);
    });
    it('custom offset of 240 stays within 300s', () => {
        const now = Math.floor(Date.now() / 1000);
        const deadline = Number(walletLinkDeadline(240));
        expect(deadline - now).toBeLessThanOrEqual(MAX_DEADLINE_SECONDS);
    });
    it('throws synchronously when offset > MAX_DEADLINE_SECONDS', () => {
        // Documents the old broken behavior: 600s default caused "deadline too far" revert
        expect(() => walletLinkDeadline(600)).toThrow('walletLinkDeadline: offsetSeconds (600) exceeds contract maximum (300)');
        expect(() => walletLinkDeadline(301)).toThrow('exceeds contract maximum');
    });
    it('MAX_DEADLINE_SECONDS is a strict upper bound, not equal-to', () => {
        // 240 (default) must be strictly less than 300 (contract max) to leave margin for clock skew
        expect(Number(walletLinkDeadline()) - Math.floor(Date.now() / 1000)).toBeLessThan(MAX_DEADLINE_SECONDS);
    });
});
//# sourceMappingURL=contracts.test.js.map