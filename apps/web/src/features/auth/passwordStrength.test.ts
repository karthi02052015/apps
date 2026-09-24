import { describe, expect, it } from 'vitest';
import { passwordStrength } from './RegisterPage';

describe('passwordStrength', () => {
  it('scores passwords from weak to strong', () => {
    expect(passwordStrength('')).toBe(0);
    expect(passwordStrength('password123')).toBe(1);
    expect(passwordStrength('correcthorse1')).toBeLessThan(passwordStrength('Correct-Horse-Battery-9'));
    expect(passwordStrength('Correct-Horse-Battery-9')).toBe(4);
  });
});
