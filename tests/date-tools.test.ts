import { describe,it,expect } from 'vitest';
import { fromHKInput,toHKInput,suggestedRelease } from '../src/components/shared';
describe('Hong Kong publication dates',()=>{
  it('converts browser datetime-local explicitly to UTC',()=>{
    expect(fromHKInput('2026-09-11T09:00')).toBe('2026-09-11T01:00:00.000Z');
    expect(toHKInput('2026-09-11T01:00:00Z')).toBe('2026-09-11T09:00');
  });
  it('releases exactly one week before class at 09:00, not 18:00',()=>{
    expect(suggestedRelease('2026-09-18T18:00:00+08:00')).toBe('2026-09-11T09:00');
  });
  it('crosses months and years without local browser timezone influence',()=>{
    expect(suggestedRelease('2027-01-02T18:00:00+08:00')).toBe('2026-12-26T09:00');
  });
  it('keeps unscheduled values empty and rejects invalid input',()=>{
    expect(fromHKInput('')).toBeNull();expect(toHKInput(null)).toBe('');expect(suggestedRelease(null)).toBe('');
    expect(()=>fromHKInput('not-a-date')).toThrow();
  });
});
