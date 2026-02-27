export interface IterativeRequestGuardState {
  sseClosed: boolean;
  reqAborted: boolean;
  reqDestroyed?: boolean;
  resWritableEnded: boolean;
  resDestroyed: boolean;
}

export function isIterativeClientDisconnected(state: IterativeRequestGuardState): boolean {
  // IncomingMessage.destroyed may become true once the request body is consumed.
  // For streaming responses this is not a reliable client-disconnect signal.
  return state.sseClosed || state.reqAborted || state.resWritableEnded || state.resDestroyed;
}
