import { describe, expect, it } from 'vitest';
import { evidenceCatalog } from '../data';
import type { ReviewRecord } from '../types';
import { applyReviewDisposition, canExportDraft, hasMissingClearingTime } from './safety';

const review: ReviewRecord = {
  reviewer: 'A. Patel, P.E.',
  role: 'Electrical engineer',
  timestamp: 'Jul 11, 2026, 1:45 PM',
  unresolvedCount: 1,
  disclaimerAccepted: true,
};

describe('draft export safety invariants', () => {
  it('blocks export until an explicit review and complete disposition exist', () => {
    expect(canExportDraft(evidenceCatalog, null)).toBe(false);
    expect(canExportDraft(evidenceCatalog, review)).toBe(false);
    expect(canExportDraft(applyReviewDisposition(evidenceCatalog), review)).toBe(true);
  });

  it('keeps the MCC-01 clearing time null through review disposition', () => {
    const disposed = applyReviewDisposition(evidenceCatalog);
    const mcc = disposed.find((item) => item.id === 'MCC-01');
    expect(mcc?.clearingTime).toBeNull();
    expect(mcc?.status).toBe('deferred');
    expect(hasMissingClearingTime(disposed)).toBe(true);
  });

  it('blocks rejected and recapture-queued evidence after an earlier approval', () => {
    const disposed = applyReviewDisposition(evidenceCatalog);
    const rejected = disposed.map((item) => item.id === 'SWGR-01' ? { ...item, status: 'rejected' as const } : item);
    const recapture = disposed.map((item) => item.id === 'CV-104' ? { ...item, status: 'recapture_queued' as const } : item);
    expect(canExportDraft(rejected, review)).toBe(false);
    expect(canExportDraft(recapture, review)).toBe(false);
  });

  it('accepts an explicit engineer-supplied clearing time without losing provenance', () => {
    const edited = evidenceCatalog.map((item) => item.id === 'MCC-01' ? {
      ...item,
      clearingTime: 0.142,
      missingFields: undefined,
      provenance: 'engineer' as const,
      engineerNote: 'Verified against breaker trip curve.',
      status: 'verified' as const,
    } : item);
    const disposed = applyReviewDisposition(edited);
    const resolvedReview = { ...review, unresolvedCount: 0 };
    expect(hasMissingClearingTime(disposed)).toBe(false);
    expect(disposed.find((item) => item.id === 'MCC-01')?.provenance).toBe('engineer');
    expect(canExportDraft(disposed, resolvedReview)).toBe(true);
  });
});
