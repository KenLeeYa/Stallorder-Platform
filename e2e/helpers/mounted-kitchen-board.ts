import { build } from "esbuild";
import type { ComponentProps } from "react";
import type { Page } from "@playwright/test";
import type { KitchenBoard } from "../../src/components/kitchen-board";

export type MountedKitchenProps = ComponentProps<typeof KitchenBoard>;

// Direct mounted-module coverage, not a production route or provider fixture.
export async function mountKitchenBoard(page: Page, props: MountedKitchenProps) {
  const result = await build({
    stdin: {
      contents: `import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { KitchenBoard } from '@/components/kitchen-board';
        const root = createRoot(document.getElementById('root'));
        window.updateKitchen = props => root.render(<KitchenBoard {...props} />);
        window.pendingBoards = {};
        window.fetch = url => new Promise(resolve => { window.pendingBoards[url] = resolve; });
        window.resolveBoard = (slug, data) => window.pendingBoards['/api/stalls/'+slug+'/kitchen/board'](new Response(JSON.stringify(data), {status:200}));
        delete window.EventSource;`,
      resolveDir: process.cwd(), loader: "tsx",
    },
    bundle: true, write: false, platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "mount-boundaries", setup(builder) {
      builder.onResolve({ filter: /^@\/components\/(kitchen-navigation|operations-locale)$/ }, (args) => ({ path: args.path, namespace: "mount" }));
      builder.onLoad({ filter: /.*/, namespace: "mount" }, (args) => ({
        loader: "tsx", resolveDir: process.cwd(),
        contents: args.path.endsWith("kitchen-navigation")
          ? `export function KitchenNavigation({stall,boardControls:c}) {return <nav><h1>{stall.name}</h1><button onClick={()=>c.onModeChange('STATION')}>station</button><button onClick={()=>c.onModeChange('ORDER')}>orders</button><button onClick={c.onToggleAlerts}>alerts</button><button onClick={c.onRefresh}>refresh</button></nav>}`
          : `export const useOperationsLocale=()=>({locale:'zh-TW',t:(key,values={})=>key+' '+Object.values(values).join(' ')});`,
      }));
    } }],
  });
  await page.route("**/__qa_mounted_kitchen", (route) => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto("/__qa_mounted_kitchen");
  await page.addScriptTag({ content: result.outputFiles[0].text });
  await updateKitchenBoard(page, props);
}

export async function updateKitchenBoard(page: Page, props: MountedKitchenProps) {
  await page.evaluate((value) => (window as unknown as { updateKitchen: (props: unknown) => void }).updateKitchen(value), props);
}

export function kitchenProps(slug: string): MountedKitchenProps {
  const station = { id: `${slug}-station`, name: `${slug} station`, code: slug };
  return {
    stall: { id: slug, organizationId: slug, slug, name: `${slug} kitchen` },
    role: "ORGANIZATION_OWNER", canManage: true, workModeDestinations: [],
    initialData: {
      settings: { warningMinutes: 10, criticalMinutes: 20, defaultView: "ORDER", timeZone: "Asia/Taipei", businessDayCutoffHour: 0 },
      stations: [station], futureReservations: [], alertOrderIds: [`${slug}-order`], serverNow: "2026-09-30T08:00:00Z",
      tasks: [{ id: `${slug}-task`, orderId: `${slug}-order`, orderItemId: `${slug}-item`, orderNo: `${slug}-001`, pickupCode: "123",
        source: "STAFF_POS", externalProvider: null, externalOrderNumber: null, scheduledPickupAt: null,
        requestedFulfillmentAt: null, committedFulfillmentAt: null, fulfillmentTimeState: "CONFIRMED", riderPickupAt: null,
        fulfillmentType: "TAKEOUT", tableLabel: null, orderNote: null, orderStatus: "CONFIRMED", orderCreatedAt: "2026-09-30T08:00:00Z",
        confirmedAt: "2026-09-30T08:00:00Z", itemName: `${slug} meal`, quantity: 1, itemNote: null, modifiers: [], station,
        status: "PENDING", startedAt: null, completedAt: null, assignedTo: null }],
    },
  };
}
