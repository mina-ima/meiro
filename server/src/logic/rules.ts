export interface ResourceState {
  wallStock: number;
  trapCharges: number;
}

export interface EventResult {
  resource: ResourceState;
  events: string[];
}

export function applyWallAdded(state: ResourceState): EventResult {
  return {
    resource: {
      ...state,
      wallStock: Math.max(0, state.wallStock - 1),
    },
    events: ['wall_added'],
  };
}

export function applyTrapPlaced(state: ResourceState): EventResult {
  return {
    resource: {
      ...state,
      trapCharges: Math.max(0, state.trapCharges - 1),
    },
    events: ['trap_placed'],
  };
}
