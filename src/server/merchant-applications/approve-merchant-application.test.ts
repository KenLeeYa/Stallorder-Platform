import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  applicationFindUnique: vi.fn(),
  organizationMembershipCount: vi.fn(),
  stallMembershipCount: vi.fn(),
  stallCount: vi.fn(),
  stallFindFirst: vi.fn(),
  organizationCount: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));

import { approveMerchantApplication } from "./approve-merchant-application";

describe("approveMerchantApplication public identifier conflicts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const transactionClient = {
      $queryRaw: mocks.queryRaw,
      merchantApplication: { findUnique: mocks.applicationFindUnique },
      organizationMembership: { count: mocks.organizationMembershipCount },
      stallMembership: { count: mocks.stallMembershipCount },
      stall: { count: mocks.stallCount, findFirst: mocks.stallFindFirst },
      organization: { count: mocks.organizationCount },
    };
    mocks.transaction.mockImplementation(async (operation) => operation(transactionClient));
    mocks.queryRaw.mockResolvedValue([]);
    mocks.applicationFindUnique.mockResolvedValue({
      id: "application-1",
      status: "PENDING_REVIEW",
      approvedOrganizationId: null,
      riskLevel: "LOW",
      applicantProfileId: "profile-1",
      applicantEmail: "applicant@example.test",
      applicant: { isActive: true, authUserId: "auth-user-1", authIdentities: [] },
      merchantName: "測試商家",
      contactName: "測試人員",
      phone: "0912345678",
      businessPhone: "0223456789",
      businessAddress: "台北市測試路 1 號",
      city: "台北市",
      stallName: "測試攤位",
      stallLocation: "台北市",
      requestedSlug: "shared-code",
      businessType: "RESTAURANT",
      preferredContactMethod: "EMAIL",
      termsAccepted: true,
      privacyAccepted: true,
      dataProcessingAccepted: true,
      informationConfirmed: true,
    });
    mocks.organizationMembershipCount.mockResolvedValue(0);
    mocks.stallMembershipCount.mockResolvedValue(0);
    mocks.organizationCount.mockResolvedValue(0);
    mocks.stallCount.mockResolvedValue(0);
    mocks.stallFindFirst.mockResolvedValue({ id: "existing-stall" });
  });

  it("rejects a cross-organization case-insensitive code collision before provisioning", async () => {
    await expect(approveMerchantApplication("application-1", {
      actorProfileId: "admin-1",
      requestId: "request-1",
      ipHash: "ip-hash",
    })).rejects.toMatchObject({ code: "SLUG_UNAVAILABLE" });

    expect(mocks.stallFindFirst).toHaveBeenCalledWith({
      where: { code: { equals: "shared-code", mode: "insensitive" } },
      select: { id: true },
    });
    expect(mocks.queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.stallFindFirst.mock.invocationCallOrder[0],
    );
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
});
