export interface GraphNode {
  id: string;
  neighbors: string[];
}

export interface PathResult {
  visited: Set<string>;
  path: string[];
}

export function breadthFirstSearch(nodes: GraphNode[], startId: string, goalId: string): PathResult {
  const queue: string[] = [startId];
  const visited = new Set<string>([startId]);
  const parent = new Map<string, string | null>([[startId, null]]);
  const adjacency = new Map(nodes.map((node) => [node.id, node.neighbors] as const));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    if (current === goalId) {
      break;
    }

    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) {
        continue;
      }

      visited.add(neighbor);
      parent.set(neighbor, current);
      queue.push(neighbor);
    }
  }

  return {
    visited,
    path: reconstructPath(parent, startId, goalId),
  };
}

function reconstructPath(parent: Map<string, string | null>, startId: string, goalId: string): string[] {
  if (!parent.has(goalId)) {
    return [];
  }

  const path: string[] = [];
  let cursor: string | null | undefined = goalId;

  while (cursor) {
    path.unshift(cursor);
    cursor = parent.get(cursor) ?? null;
  }

  return path[0] === startId ? path : [];
}
