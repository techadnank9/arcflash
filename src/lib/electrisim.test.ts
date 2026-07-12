import { describe, expect, it } from 'vitest';
import {
  isTerminalElectrisimState,
  normalizeElectrisimChanges,
  normalizeElectrisimCalculation,
  normalizeElectrisimSession,
  readElectrisimApiError,
} from './electrisim';

describe('normalizeElectrisimSession', () => {
  it('normalizes nested H session status and links', () => {
    expect(normalizeElectrisimSession({
      session: {
        id: 'session-1',
        status: { status: 'running' },
        agent_view_url: 'https://platform.hcompany.ai/session-1',
      },
      current_url: 'https://electrisim.com/docs',
    })).toEqual({
      id: 'session-1',
      state: 'running',
      agentViewUrl: 'https://platform.hcompany.ai/session-1',
      currentUrl: 'https://electrisim.com/docs',
      summary: undefined,
      screenshotUrl: undefined,
      workflow: undefined,
    });
  });

  it('uses a known id for sparse stop responses', () => {
    expect(normalizeElectrisimSession({ status: 'interrupted' }, 'session-2'))
      .toMatchObject({ id: 'session-2', state: 'interrupted' });
  });

  it('reads the final answer from the real H session field', () => {
    expect(normalizeElectrisimSession({
      id: 'session-3',
      status: { status: 'completed' },
      latest_answer: 'Public Electrisim walkthrough completed.',
    })?.summary).toBe('Public Electrisim walkthrough completed.');
  });
});

describe('normalizeElectrisimChanges', () => {
  it('extracts screenshots and browser actions without exposing raw event shape', () => {
    const changes = normalizeElectrisimChanges({
      new_events: [
        {
          timestamp: '2026-07-11T00:00:01Z',
          type: 'AgentEvent',
          data: {
            kind: 'observation_event',
            image: { source: 'https://cdn.hcompany.ai/frame.png', type: 'url' },
            metadata: { url: 'https://electrisim.com/docs', title: 'Documentation' },
          },
        },
        {
          timestamp: '2026-07-11T00:00:02Z',
          type: 'AgentEvent',
          data: { kind: 'policy_event', tool_reqs: [{ name: 'click', target: 'Try the Editor Free' }] },
        },
      ],
      answer: 'Public exploration finished.',
    }, 4);

    expect(changes.nextIndex).toBe(6);
    expect(changes.answer).toBe('Public exploration finished.');
    expect(changes.state).toBeUndefined();
    expect(changes.events[0]).toMatchObject({
      kind: 'observation',
      currentUrl: 'https://electrisim.com/docs',
      screenshotUrl: 'https://cdn.hcompany.ai/frame.png',
    });
    expect(changes.events[1].detail).toContain('click');
  });

  it('reads structured final answers returned by session changes', () => {
    const changes = normalizeElectrisimChanges({
      new_events: [],
      status: 'completed',
      answer: { content: 'Stopped before the subscription boundary.' },
    });

    expect(changes.answer).toBe('Stopped before the subscription boundary.');
    expect(changes.state).toBe('completed');
  });
});

describe('Electrisim state and errors', () => {
  it('recognizes terminal session states', () => {
    expect(isTerminalElectrisimState('completed')).toBe(true);
    expect(isTerminalElectrisimState('running')).toBe(false);
  });

  it('prefers an upstream error message', () => {
    expect(readElectrisimApiError({ detail: { message: 'Agent unavailable' } }, 'Failed'))
      .toBe('Agent unavailable');
  });
});

describe('normalizeElectrisimCalculation', () => {
  it('keeps missing engineering values explicitly null', () => {
    const result = normalizeElectrisimCalculation({
      schema_version: '1.0',
      generated_at: '2026-07-11T00:00:00Z',
      project: 'CV-104',
      study_case: 'Case A',
      engines: { short_circuit: 'pandapower', arc_flash: 'arcflash-calc' },
      disclaimer: 'Review required.',
      results: [{
        equipment_id: 'MCC-01',
        pandapower_bolted_fault_ka: 18.2,
        arcflash_validation: {
          arcing_current_ka: 12.4,
          incident_energy_cal_cm2: null,
          arc_flash_boundary_in: null,
        },
        verification_status: 'engineer_review_required',
      }],
    });

    expect(result?.results[0].arcflash_validation.incident_energy_cal_cm2).toBeNull();
    expect(result?.results[0].verification_status).toBe('engineer_review_required');
  });
});
