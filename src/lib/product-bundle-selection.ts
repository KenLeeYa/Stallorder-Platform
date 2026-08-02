export type SelectableBundleChoiceGroup = {
  minSelections: number;
  maxSelections: number;
  options: Array<{ id: string; priceDelta: number }>;
};

export function toggleBundleChoice(
  current: readonly string[],
  group: SelectableBundleChoiceGroup,
  choiceId: string | null,
) {
  const groupChoiceIds = new Set(group.options.map((option) => option.id));
  const outsideGroup = current.filter((id) => !groupChoiceIds.has(id));
  const selectedInGroup = current.filter((id) => groupChoiceIds.has(id));
  if (choiceId === null) return outsideGroup;
  if (group.maxSelections === 1) return [...outsideGroup, choiceId];
  if (selectedInGroup.includes(choiceId)) {
    return [...outsideGroup, ...selectedInGroup.filter((id) => id !== choiceId)];
  }
  if (selectedInGroup.length >= group.maxSelections) return [...current];
  return [...outsideGroup, ...selectedInGroup, choiceId];
}

export function bundleSelectionIsValid(
  groups: readonly SelectableBundleChoiceGroup[] | undefined,
  selectedIds: readonly string[],
) {
  const availableGroups = groups ?? [];
  const allowedIds = new Set(availableGroups.flatMap((group) => group.options.map((option) => option.id)));
  if (selectedIds.some((id) => !allowedIds.has(id))) return false;
  return availableGroups.every((group) => {
    const groupIds = new Set(group.options.map((option) => option.id));
    const count = selectedIds.filter((id) => groupIds.has(id)).length;
    return count >= group.minSelections && count <= group.maxSelections;
  });
}

export function bundlePriceAdjustment(
  groups: readonly SelectableBundleChoiceGroup[] | undefined,
  selectedIds: readonly string[],
) {
  const selected = new Set(selectedIds);
  return (groups ?? []).flatMap((group) => group.options)
    .filter((option) => selected.has(option.id))
    .reduce((total, option) => total + option.priceDelta, 0);
}
