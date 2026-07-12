export interface HExecutionPresentation {
  className: 'is-connecting' | 'is-hosted' | 'is-replay';
  isHosted: boolean;
  label: string;
  status: string;
}

const failedStates = new Set(['connection_lost', 'failed', 'fallback', 'interrupted', 'timed_out']);

export function hExecutionPresentation(sessionId: string | null, sessionState: string): HExecutionPresentation {
  const state = sessionState.trim().toLowerCase();
  if (sessionId && !failedStates.has(state)) {
    return {
      className: 'is-hosted',
      isHosted: true,
      label: 'H HOSTED BROWSER + LOCAL REPLAY',
      status: `H SESSION ${sessionId.slice(0, 8).toUpperCase()}${state === 'completed' ? ' · COMPLETE' : ''}`,
    };
  }
  if (state === 'starting') {
    return {
      className: 'is-connecting',
      isHosted: false,
      label: 'CONNECTING TO H HOSTED BROWSER',
      status: 'SESSION REQUESTED',
    };
  }
  const failedStatus = state === 'fallback'
    ? 'H START FAILED · LOCAL REPLAY'
    : state === 'connection_lost'
      ? 'H CONNECTION LOST · LOCAL REPLAY'
      : sessionId && failedStates.has(state)
        ? `H ${state.replace('_', ' ').toUpperCase()} · LOCAL REPLAY`
        : 'DETERMINISTIC LOCAL REPLAY';
  return {
    className: 'is-replay',
    isHosted: false,
    label: 'VISUAL WORKFLOW REPLAY',
    status: failedStatus,
  };
}
