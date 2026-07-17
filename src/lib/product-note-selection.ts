export type SelectableNoteGroup = {
  selectionMode: "SINGLE" | "MULTIPLE";
  minSelections: number;
  maxSelections: number | null;
  options: Array<{ id: string; priceDelta: number }>;
};

export function toggleNoteOption(
  current: readonly string[],
  group: SelectableNoteGroup,
  optionId: string | null,
) {
  const groupOptionIds = new Set(group.options.map((option) => option.id));
  const outsideGroup = current.filter((id) => !groupOptionIds.has(id));
  const selectedInGroup = current.filter((id) => groupOptionIds.has(id));

  if (group.selectionMode === "SINGLE") {
    return optionId ? [...outsideGroup, optionId] : outsideGroup;
  }
  if (!optionId) return [...outsideGroup, ...selectedInGroup];
  if (selectedInGroup.includes(optionId)) {
    return [...outsideGroup, ...selectedInGroup.filter((id) => id !== optionId)];
  }
  if (group.maxSelections !== null && selectedInGroup.length >= group.maxSelections) return [...current];
  return [...outsideGroup, ...selectedInGroup, optionId];
}

export function noteSelectionIsValid(groups: readonly SelectableNoteGroup[], selectedIds: readonly string[]) {
  return groups.every((group) => {
    const optionIds = new Set(group.options.map((option) => option.id));
    const count = selectedIds.filter((id) => optionIds.has(id)).length;
    return count >= group.minSelections && (group.maxSelections === null || count <= group.maxSelections);
  });
}

export function notePriceAdjustment(groups: readonly SelectableNoteGroup[], selectedIds: readonly string[]) {
  const selected = new Set(selectedIds);
  return groups.flatMap((group) => group.options)
    .filter((option) => selected.has(option.id))
    .reduce((total, option) => total + option.priceDelta, 0);
}
