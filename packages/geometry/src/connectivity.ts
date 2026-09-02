import type { CubeElement, ElementId } from "@blockbench-codex/contracts";

import { overlapsOrTouches } from "./bounds.js";

export interface ConnectivityReport {
  readonly connected: boolean;
  readonly edgeCount: number;
  readonly components: readonly (readonly ElementId[])[];
}

export function inspectConnectivity(
  elements: readonly CubeElement[],
  tolerance = 0,
): ConnectivityReport {
  const neighbors = new Map<ElementId, ElementId[]>();
  for (const element of elements) neighbors.set(element.id, []);
  let edgeCount = 0;
  for (let left = 0; left < elements.length; left++) {
    for (let right = left + 1; right < elements.length; right++) {
      const a = elements[left]!;
      const b = elements[right]!;
      if (!overlapsOrTouches(a.bounds, b.bounds, tolerance)) continue;
      neighbors.get(a.id)!.push(b.id);
      neighbors.get(b.id)!.push(a.id);
      edgeCount++;
    }
  }
  const remaining = new Set(neighbors.keys());
  const components: ElementId[][] = [];
  while (remaining.size > 0) {
    const first = remaining.values().next().value as ElementId;
    const component: ElementId[] = [];
    const pending = [first];
    remaining.delete(first);
    while (pending.length > 0) {
      const current = pending.pop()!;
      component.push(current);
      for (const neighbor of neighbors.get(current)!) {
        if (!remaining.delete(neighbor)) continue;
        pending.push(neighbor);
      }
    }
    components.push(component);
  }
  return {
    connected: elements.length > 0 && components.length === 1,
    edgeCount,
    components,
  };
}
