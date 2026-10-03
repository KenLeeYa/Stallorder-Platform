import { productEventSchema, type ProductEvent } from "@/lib/analytics-contract";
export type AnalyticsAdapter = {
    capture(event: ProductEvent, signal: AbortSignal): Promise<void>;
    reset(): void;
};
export const noopAnalytics: AnalyticsAdapter = { async capture(event) { productEventSchema.parse(event); }, reset() { } };
export function createTestAnalytics() {
    const events: ProductEvent[] = [];
    return { async capture(input: ProductEvent, signal: AbortSignal) { const event = productEventSchema.parse(input); if (!signal.aborted) {
            events.push(event);
            if (events.length > 100)
                events.shift();
        } }, reset() { events.length = 0; }, flush() { const result = events.slice(); events.length = 0; return result; } } satisfies AnalyticsAdapter & {
        flush(): ProductEvent[];
    };
}
// Trusted server/test composition only. No request or environment selects a sink.
export function createProductAnalytics<Principal>(sink: AnalyticsAdapter, consent: (principal: Principal) => Promise<boolean>, key: (principal: Principal) => string) {
    const pending = new Map<string, Set<AbortController>>();
    function invalidate(principalKey: string) { pending.get(principalKey)?.forEach(c => c.abort()); pending.delete(principalKey); try {
        sink.reset();
    }
    catch { /* Optional telemetry cannot fail logout or withdrawal. */ } }
    async function capture(principal: Principal, input: unknown) {
        const event = productEventSchema.parse(input); // Strict even before OFF/Noop.
        const id = key(principal), controller = new AbortController(), set = pending.get(id) ?? new Set<AbortController>();
        set.add(controller);
        pending.set(id, set);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const work = Promise.resolve().then(async () => { if (await consent(principal) && !controller.signal.aborted)
                await sink.capture(event, controller.signal); }).catch(() => undefined);
            await Promise.race([work, new Promise<void>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(); }, 50); })]);
        }
        finally {
            if (timer)
                clearTimeout(timer);
            controller.abort();
            set.delete(controller);
            if (!set.size && pending.get(id) === set)
                pending.delete(id);
        }
    }
    return { capture, invalidate };
}
