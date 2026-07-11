import type { Evidence, ReviewRecord } from '../types';

export function applyReviewDisposition(evidence: Evidence[]): Evidence[] {
  return evidence.map((item) => ({
    ...item,
    status: item.clearingTime == null ? 'deferred' : 'accepted',
  }));
}

export function canExportDraft(evidence: Evidence[], review: ReviewRecord | null): boolean {
  if (!review?.disclaimerAccepted || evidence.length !== 3) return false;
  return evidence.every((item) => item.status === 'accepted' || item.status === 'deferred');
}

export function hasMissingClearingTime(evidence: Evidence[], equipmentId = 'MCC-01'): boolean {
  const item = evidence.find((entry) => entry.id === equipmentId);
  return Boolean(item && item.clearingTime === null && item.missingFields?.includes('protectiveDeviceClearingTime'));
}
