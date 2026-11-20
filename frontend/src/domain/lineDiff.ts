export interface DiffLine {
  kind: "same" | "removed" | "added";
  text: string;
  oldLine?: number;
  newLine?: number;
}

const MAX_MATRIX_CELLS = 250_000;

export function createLineDiff(previousText: string, nextText: string): DiffLine[] {
  const previous = previousText.split("\n");
  const next = nextText.split("\n");
  if ((previous.length + 1) * (next.length + 1) > MAX_MATRIX_CELLS) {
    return [
      ...previous.map((text, index): DiffLine => ({
        kind: "removed",
        text,
        oldLine: index + 1,
      })),
      ...next.map((text, index): DiffLine => ({
        kind: "added",
        text,
        newLine: index + 1,
      })),
    ];
  }

  const width = next.length + 1;
  const matrix = new Uint32Array((previous.length + 1) * width);
  for (let oldIndex = previous.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = next.length - 1; newIndex >= 0; newIndex -= 1) {
      const cell = oldIndex * width + newIndex;
      matrix[cell] = previous[oldIndex] === next[newIndex]
        ? matrix[(oldIndex + 1) * width + newIndex + 1] + 1
        : Math.max(matrix[(oldIndex + 1) * width + newIndex], matrix[cell + 1]);
    }
  }

  const diff: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < previous.length && newIndex < next.length) {
    if (previous[oldIndex] === next[newIndex]) {
      diff.push({
        kind: "same",
        text: previous[oldIndex],
        oldLine: oldIndex + 1,
        newLine: newIndex + 1,
      });
      oldIndex += 1;
      newIndex += 1;
    } else if (
      matrix[(oldIndex + 1) * width + newIndex] >=
      matrix[oldIndex * width + newIndex + 1]
    ) {
      diff.push({ kind: "removed", text: previous[oldIndex], oldLine: oldIndex + 1 });
      oldIndex += 1;
    } else {
      diff.push({ kind: "added", text: next[newIndex], newLine: newIndex + 1 });
      newIndex += 1;
    }
  }
  while (oldIndex < previous.length) {
    diff.push({ kind: "removed", text: previous[oldIndex], oldLine: oldIndex + 1 });
    oldIndex += 1;
  }
  while (newIndex < next.length) {
    diff.push({ kind: "added", text: next[newIndex], newLine: newIndex + 1 });
    newIndex += 1;
  }
  return diff;
}
