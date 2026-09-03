import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LotteryRewardEligibilityDialog } from "@/components/qr-lottery-dialogs";

describe("lottery reward eligibility reminder", () => {
  it("renders the reward reminder as a centered alert dialog", () => {
    const html = renderToStaticMarkup(
      <LotteryRewardEligibilityDialog
        title="恭喜獲得一次免費餐點抽獎"
        description="完成抽獎後，餐點會以 0 元加入訂單。"
        confirmLabel="開始抽獎"
        backLabel="先回去看看"
        onConfirm={() => undefined}
        onBack={() => undefined}
      />,
    );

    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('data-testid="lottery-reward-eligibility-dialog"');
    expect(html).toContain("恭喜獲得一次免費餐點抽獎");
  });
});
