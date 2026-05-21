import type { OperationGroup } from "../parser/types.js";

export function commandNamesForGroup(group: OperationGroup): string[] {
  const baseNames = group.operations.map((op) => simplifyName(op.id, group.tag));
  const baseCounts = new Map<string, number>();
  for (const name of baseNames) {
    baseCounts.set(name, (baseCounts.get(name) ?? 0) + 1);
  }

  const used = new Map<string, number>();
  return group.operations.map((op, index) => {
    const baseName = baseNames[index];
    const hasCollision = (baseCounts.get(baseName) ?? 0) > 1;
    const preferred = hasCollision ? `${baseName}-${op.method.toLowerCase()}` : baseName;
    const seen = used.get(preferred) ?? 0;
    used.set(preferred, seen + 1);
    return seen === 0 ? preferred : `${preferred}-${seen + 1}`;
  });
}

export function simplifyName(operationId: string, tag: string): string {
  const tagLower = tag.toLowerCase();
  const idLower = operationId.toLowerCase();
  const singular = tagLower.endsWith("s") ? tagLower.slice(0, -1) : tagLower;

  for (const suffix of [tagLower, singular]) {
    if (idLower.endsWith(suffix) && idLower.length > suffix.length) {
      return operationId.slice(0, operationId.length - suffix.length).toLowerCase();
    }
  }
  return operationId.toLowerCase();
}
