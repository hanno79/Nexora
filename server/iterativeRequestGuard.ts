/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Hilfslogik zur Erkennung getrennter Iterative-Streaming-Clients.
*/

// ÄNDERUNG 08.03.2026: Header und Aenderungsdokumentation fuer Phase-0-Quick-Wins ergaenzt.

export interface IterativeRequestGuardState {
  sseClosed: boolean;
  reqAborted: boolean;
  reqDestroyed?: boolean;
  resWritableEnded: boolean;
  resDestroyed: boolean;
}

export function isIterativeClientDisconnected(state: IterativeRequestGuardState): boolean {
  // IncomingMessage.destroyed kann bereits true werden, sobald der Request-Body konsumiert wurde.
  // Fuer Streaming-Responses ist das deshalb kein verlaessliches Disconnect-Signal.
  return state.sseClosed || state.reqAborted || state.resWritableEnded || state.resDestroyed;
}
