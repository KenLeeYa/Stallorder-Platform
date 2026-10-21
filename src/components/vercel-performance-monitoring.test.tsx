import { describe, expect, it, vi } from "vitest";
const observed = vi.hoisted(() => ({ imports: [] as string[] }));
vi.mock("@vercel/analytics/next", () => { observed.imports.push("analytics"); return { Analytics: () => null }; });
vi.mock("@vercel/speed-insights/next", () => { observed.imports.push("speed-insights"); return { SpeedInsights: () => null }; });
vi.mock("next/navigation", () => ({ usePathname: () => "/merchant" }));
import { VercelPerformanceMonitoring } from "./vercel-performance-monitoring";
describe("Vercel monitoring disabled until SDK withdrawal is provable", () => {
    it("does not import a collector or return a mountable SDK even on a private route", () => {
        expect(observed.imports).toEqual([]);
        expect(VercelPerformanceMonitoring()).toBeNull();
    });
});
