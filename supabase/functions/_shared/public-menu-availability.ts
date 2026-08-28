export type PublicMenuAvailabilityWindow = {
  availableFrom?: string | null;
  availableUntil?: string | null;
};

type AvailabilityBundleOption = PublicMenuAvailabilityWindow & { id: string };

type AvailabilityBundleGroup = {
  minSelections: number;
  options: AvailabilityBundleOption[];
};

type AvailabilityProduct = PublicMenuAvailabilityWindow & {
  kind: "SINGLE" | "BUNDLE";
  isSoldOut?: boolean;
  bundleChoiceGroups?: AvailabilityBundleGroup[];
};

function parseAvailabilityTime(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

export function publicMenuItemIsAvailableAt(
  item: PublicMenuAvailabilityWindow,
  target: string | number,
) {
  const targetTimestamp = typeof target === "number" ? target : Date.parse(target);
  if (!Number.isFinite(targetTimestamp)) return false;

  const availableFrom = parseAvailabilityTime(item.availableFrom);
  const availableUntil = parseAvailabilityTime(item.availableUntil);
  return !Number.isNaN(availableFrom)
    && !Number.isNaN(availableUntil)
    && (availableFrom === null || availableFrom <= targetTimestamp)
    && (availableUntil === null || availableUntil > targetTimestamp);
}

export function filterPublicMenuProductsForTime<T extends AvailabilityProduct>(
  products: readonly T[],
  target: string | number,
): T[] {
  return products.flatMap((product) => {
    if (!publicMenuItemIsAvailableAt(product, target)) return [];
    if (product.isSoldOut) return [product];
    if (product.kind !== "BUNDLE") return [product];

    const groups = product.bundleChoiceGroups ?? [];
    const filteredGroups = groups.map((group) => ({
      ...group,
      options: group.options.filter((option) => publicMenuItemIsAvailableAt(option, target)),
    }));
    const isComplete = filteredGroups.length > 0
      && filteredGroups.every((group) => (
        group.options.length >= group.minSelections
      ));
    return isComplete
      ? [{ ...product, bundleChoiceGroups: filteredGroups } as T]
      : [];
  });
}

export function filterPublicMenuProductsForTimeWindow<T extends AvailabilityProduct>(
  products: readonly T[],
  targets: readonly string[],
): T[] {
  const targetTimestamps = targets
    .map((target) => Date.parse(target))
    .filter((target) => Number.isFinite(target));
  if (targetTimestamps.length === 0) return [];

  return products.flatMap((product) => {
    const productTargets = targetTimestamps.filter((target) => (
      publicMenuItemIsAvailableAt(product, target)
    ));
    if (productTargets.length === 0) return [];
    if (product.isSoldOut) return [product];
    if (product.kind !== "BUNDLE") return [product];

    const groups = product.bundleChoiceGroups ?? [];
    const completeTargets = productTargets.filter((target) => groups.length > 0
      && groups.every((group) => (
        group.options.filter((option) => publicMenuItemIsAvailableAt(option, target)).length
          >= group.minSelections
      )));
    if (completeTargets.length === 0) return [];

    const filteredGroups = groups.map((group) => ({
      ...group,
      options: group.options.filter((option) => completeTargets.some((target) => (
        publicMenuItemIsAvailableAt(option, target)
      ))),
    }));
    return [{ ...product, bundleChoiceGroups: filteredGroups } as T];
  });
}
