import { days, inr, signedPercent } from './format';

describe('inr', () => {
  it('uses lakhs and crores for large amounts', () => {
    expect(inr(20_287_879)).toBe('₹2.03 Cr');
    expect(inr(4_759_996)).toBe('₹47.6 L');
    expect(inr(815_989)).toBe('₹8.16 L');
  });
  it('shows full amounts below a lakh with Indian grouping', () => {
    expect(inr(91_590)).toBe('₹91,590');
    expect(inr(1_234_567, { compact: false })).toBe('₹12,34,567');
  });
});

describe('days', () => {
  it('describes stock cover in words', () => {
    expect(days(0)).toBe('Out now');
    expect(days(0.4)).toBe('< 1 day');
    expect(days(1)).toBe('1 day');
    expect(days(12.4)).toBe('12 days');
    expect(days(null)).toBe('—');
  });
});

it('formats signed percentages', () => {
  expect(signedPercent(0.064)).toBe('+6.4%');
  expect(signedPercent(-0.12)).toBe('−12.0%');
});
