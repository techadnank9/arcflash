import { describe, expect, it } from 'vitest';
import { hExecutionPresentation } from './hcomputer';

describe('hExecutionPresentation', () => {
  it('claims H hosting only after a session id is attached', () => {
    expect(hExecutionPresentation(null, 'running')).toMatchObject({
      isHosted: false,
      label: 'VISUAL WORKFLOW REPLAY',
    });
    expect(hExecutionPresentation('session-12345678', 'running')).toMatchObject({
      isHosted: true,
      label: 'H HOSTED BROWSER + LOCAL REPLAY',
    });
  });

  it('makes a failed H start explicit', () => {
    expect(hExecutionPresentation(null, 'fallback')).toEqual({
      className: 'is-replay',
      isHosted: false,
      label: 'VISUAL WORKFLOW REPLAY',
      status: 'H START FAILED · LOCAL REPLAY',
    });
  });

  it('stops claiming a hosted run after a terminal H failure', () => {
    expect(hExecutionPresentation('session-12345678', 'failed')).toMatchObject({
      isHosted: false,
      status: 'H FAILED · LOCAL REPLAY',
    });
  });
});
