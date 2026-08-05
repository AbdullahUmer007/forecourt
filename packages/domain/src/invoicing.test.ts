import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  allocateNumber, findNumberGaps, buildInvoice, issueInvoice, creditNoteFor,
  invoiceBalance, validateRefund,
  type InvoiceSequence, type Payment,
} from './invoicing.js';
import { formatRegistration } from './invoice-document.js';
import { money } from './money.js';
import type { VatRule } from './vat.js';

const RULE: VatRule = {
  key: 'vat.margin_fraction',
  effectiveFrom: '2011-01-04',
  numerator: 1n,
  denominator: 6n,
  standardRateBps: 2000,
  sourceUrl: 'https://www.gov.uk/guidance/the-margin-scheme-on-second-hand-cars-and-other-vehicles-vat-notice-7181',
};

const seq = (over: Partial<InvoiceSequence> = {}): InvoiceSequence => ({
  tenantId: 't1', series: 'sale', prefix: 'KEN-', lastNumber: 0n, ...over,
});

const AUG = (d: number): Date => new Date(Date.UTC(2026, 7, d, 12));

// ---------------------------------------------------------------- numbering
describe('gapless invoice numbering', () => {
  it('starts at 1 and pads the reference', () => {
    const a = allocateNumber(seq());
    expect(a.number).toBe(1n);
    expect(a.reference).toBe('KEN-000001');
  });

  it('returns the updated counter rather than mutating', () => {
    // The caller must persist this in the SAME transaction as the invoice.
    // Returning it makes that impossible to forget silently.
    const s = seq();
    const a = allocateNumber(s);
    expect(s.lastNumber).toBe(0n);
    expect(a.sequence.lastNumber).toBe(1n);
  });

  it('produces an unbroken run over many allocations', () => {
    let s = seq();
    const numbers: bigint[] = [];
    for (let i = 0; i < 250; i++) {
      const a = allocateNumber(s);
      numbers.push(a.number);
      s = a.sequence;
    }
    expect(findNumberGaps(numbers)).toEqual([]);
    expect(numbers[249]).toBe(250n);
  });

  it('spots a gap, because HMRC will', () => {
    expect(findNumberGaps([1n, 2n, 4n, 5n])).toEqual([3n]);
    expect(findNumberGaps([1n, 2n, 3n])).toEqual([]);
    expect(findNumberGaps([])).toEqual([]);
  });
});

// ------------------------------------------------------- margin scheme VAT
describe('a margin-scheme invoice', () => {
  const marginInvoice = () => buildInvoice({
    vatScheme: 'margin',
    purchasePrice: money(1_000_000n),
    lines: [
      // Deliberately passing a VAT rate that must be ignored.
      { description: '2022 Tesla Model X', unitPrice: money(1_200_000n), vatRateBps: 2000 },
    ],
    vatRule: RULE,
  });

  it('NEVER shows VAT on any line, whatever the caller passed', () => {
    // The single most expensive mistake in the product: showing VAT makes the
    // whole sale standard-rated.
    const inv = marginInvoice();
    for (const line of inv.lines) {
      expect(line.vatAmount.amount).toBe(0n);
      expect(line.vatRateBps).toBe(0);
    }
    expect(inv.vatTotal.amount).toBe(0n);
  });

  it('still computes the dealer’s own VAT on the margin, separately', () => {
    // £12,000 sale − £10,000 cost = £2,000 margin. £2,000 × 1/6 = £333.33.
    const inv = marginInvoice();
    expect(inv.vatCalculation?.scheme).toBe('margin');
    expect(inv.vatCalculation?.vatDue.amount).toBe(33_333n);
  });

  it('keeps that figure OFF the document totals', () => {
    const inv = marginInvoice();
    expect(inv.grossTotal.amount).toBe(1_200_000n);
    expect(inv.netTotal.amount).toBe(1_200_000n);
  });

  it('produces no VAT on a loss-making sale, and never offsets it', () => {
    const inv = buildInvoice({
      vatScheme: 'margin',
      purchasePrice: money(1_200_000n),
      lines: [{ description: 'Sold at a loss', unitPrice: money(1_000_000n) }],
      vatRule: RULE,
    });
    expect(inv.vatCalculation?.vatDue.amount).toBe(0n);
    expect(inv.vatTotal.amount).toBe(0n);
  });
});

describe('a VAT-qualifying invoice', () => {
  it('does show VAT, because that is the whole point of qualifying stock', () => {
    const inv = buildInvoice({
      vatScheme: 'qualifying',
      lines: [{ description: 'Ex-fleet Transit', unitPrice: money(1_000_000n), vatRateBps: 2000 }],
      vatRule: RULE,
    });
    expect(inv.vatTotal.amount).toBe(200_000n);
    expect(inv.grossTotal.amount).toBe(1_200_000n);
  });
});

// ------------------------------------------------------------- issuing
describe('issuing', () => {
  const draft = () => buildInvoice({
    vatScheme: 'margin', purchasePrice: money(1_000_000n),
    lines: [{ description: 'Car', unitPrice: money(1_200_000n) }],
    vatRule: RULE,
  });

  it('allocates the number only at issue', () => {
    const d = draft();
    expect(d.number).toBeNull();
    const { invoice } = issueInvoice(d, seq(), AUG(3));
    expect(invoice.number).toBe(1n);
    expect(invoice.status).toBe('issued');
  });

  it('refuses to issue twice', () => {
    const { invoice } = issueInvoice(draft(), seq(), AUG(3));
    expect(() => issueInvoice(invoice, seq({ lastNumber: 1n }), AUG(3))).toThrow(/already been issued/);
  });

  it('refuses to issue an empty invoice', () => {
    const empty = buildInvoice({ vatScheme: 'qualifying', lines: [], vatRule: RULE });
    expect(() => issueInvoice(empty, seq(), AUG(3))).toThrow(/at least one line/);
  });
});

// ---------------------------------------------------------- credit notes
describe('cancelling an issued invoice', () => {
  const issued = () => issueInvoice(
    buildInvoice({
      vatScheme: 'qualifying',
      lines: [{ description: 'Car', unitPrice: money(1_000_000n), vatRateBps: 2000 }],
      vatRule: RULE,
    }),
    seq(), AUG(3),
  );

  it('raises a credit note with its OWN number, keeping the series gapless', () => {
    // Never a deleted row and never a released number.
    const { invoice, sequence } = issued();
    const credit = creditNoteFor(invoice, sequence, 'Customer withdrew', AUG(4));
    expect(credit.invoice.number).toBe(2n);
    expect(findNumberGaps([invoice.number!, credit.invoice.number!])).toEqual([]);
  });

  it('reverses every amount', () => {
    const { invoice, sequence } = issued();
    const credit = creditNoteFor(invoice, sequence, 'Customer withdrew', AUG(4));
    expect(credit.invoice.grossTotal.amount).toBe(-1_200_000n);
    expect(credit.invoice.vatTotal.amount).toBe(-200_000n);
    expect(credit.invoice.kind).toBe('credit_note');
  });

  it('demands a reason', () => {
    const { invoice, sequence } = issued();
    expect(() => creditNoteFor(invoice, sequence, '  ', AUG(4))).toThrow(/say why/);
  });

  it('refuses to credit a draft — discard it instead', () => {
    const d = buildInvoice({
      vatScheme: 'qualifying', lines: [{ description: 'x', unitPrice: money(100n) }], vatRule: RULE,
    });
    expect(() => creditNoteFor(d, seq(), 'nope', AUG(4))).toThrow(/no number to credit/);
  });
});

// --------------------------------------------------------------- balances
describe('balances and refunds', () => {
  const invoice = () => issueInvoice(
    buildInvoice({
      vatScheme: 'margin', purchasePrice: money(1_000_000n),
      lines: [{ description: 'Car', unitPrice: money(1_200_000n) }],
      vatRule: RULE,
    }), seq(), AUG(3)).invoice;

  const pay = (amount: bigint, direction: 'in' | 'out' = 'in'): Payment =>
    ({ method: 'card', amount: money(amount), direction, receivedAt: AUG(4) });

  it('reports part paid, then paid', () => {
    const inv = invoice();
    expect(invoiceBalance(inv, [pay(500_000n)]).status).toBe('part_paid');
    expect(invoiceBalance(inv, [pay(1_200_000n)]).status).toBe('paid');
  });

  it('nets refunds off the paid total', () => {
    const b = invoiceBalance(invoice(), [pay(1_200_000n), pay(200_000n, 'out')]);
    expect(b.paid.amount).toBe(1_000_000n);
    expect(b.outstanding.amount).toBe(200_000n);
  });

  it('refuses to refund more than was taken', () => {
    const r = validateRefund(money(500_000n), [pay(300_000n)]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('only');
  });

  it('counts earlier refunds against the refundable amount', () => {
    const r = validateRefund(money(200_000n), [pay(500_000n), pay(400_000n, 'out')]);
    expect(r.ok).toBe(false);
  });

  it('refuses a zero or negative refund', () => {
    expect(validateRefund(money(0n), [pay(100n)]).ok).toBe(false);
    expect(validateRefund(money(-100n), [pay(100n)]).ok).toBe(false);
  });
});

// ------------------------------------------------------- property tests
describe('money properties', () => {
  it('an invoice always reconciles: gross = net + VAT', () => {
    fc.assert(fc.property(
      fc.array(fc.tuple(fc.bigInt(1n, 5_000_000n), fc.integer({ min: 0, max: 2000 })), { minLength: 1, maxLength: 8 }),
      (rows) => {
        const inv = buildInvoice({
          vatScheme: 'qualifying',
          lines: rows.map(([price, bps], i) => ({
            description: `Line ${i}`, unitPrice: money(price), vatRateBps: bps,
          })),
          vatRule: RULE,
        });
        expect(inv.grossTotal.amount).toBe(inv.netTotal.amount + inv.vatTotal.amount);
        for (const l of inv.lines) {
          expect(l.gross.amount).toBe(l.net.amount + l.vatAmount.amount);
        }
      },
    ), { numRuns: 300 });
  });

  it('a margin invoice NEVER carries VAT, for any input at all', () => {
    // The invariant that protects the dealer's whole VAT position.
    fc.assert(fc.property(
      fc.bigInt(1n, 9_000_000n), fc.bigInt(1n, 9_000_000n), fc.integer({ min: 0, max: 2000 }),
      (purchase, sale, bps) => {
        const inv = buildInvoice({
          vatScheme: 'margin',
          purchasePrice: money(purchase),
          lines: [{ description: 'Car', unitPrice: money(sale), vatRateBps: bps }],
          vatRule: RULE,
        });
        expect(inv.vatTotal.amount).toBe(0n);
        expect(inv.lines.every((l) => l.vatAmount.amount === 0n)).toBe(true);
      },
    ), { numRuns: 500 });
  });

  it('margin VAT is never negative and never exceeds the margin', () => {
    fc.assert(fc.property(
      fc.bigInt(1n, 9_000_000n), fc.bigInt(1n, 9_000_000n),
      (purchase, sale) => {
        const inv = buildInvoice({
          vatScheme: 'margin', purchasePrice: money(purchase),
          lines: [{ description: 'Car', unitPrice: money(sale) }],
          vatRule: RULE,
        });
        const vat = inv.vatCalculation!.vatDue.amount;
        expect(vat >= 0n).toBe(true);
        if (sale > purchase) expect(vat <= sale - purchase).toBe(true);
      },
    ), { numRuns: 500 });
  });

  it('a credit note exactly reverses its original', () => {
    fc.assert(fc.property(
      fc.bigInt(1n, 5_000_000n),
      (price) => {
        const { invoice, sequence } = issueInvoice(buildInvoice({
          vatScheme: 'qualifying',
          lines: [{ description: 'Car', unitPrice: money(price), vatRateBps: 2000 }],
          vatRule: RULE,
        }), seq(), AUG(3));
        const credit = creditNoteFor(invoice, sequence, 'Reversed', AUG(4));
        expect(invoice.grossTotal.amount + credit.invoice.grossTotal.amount).toBe(0n);
      },
    ), { numRuns: 300 });
  });
});

describe('a registration as a human reads it', () => {
  it('spaces a current-format plate 4 + 3', () => {
    expect(formatRegistration('WD21KXR')).toBe('WD21 KXR');
    expect(formatRegistration('wd21 kxr')).toBe('WD21 KXR');
  });

  it('leaves a Northern Ireland plate alone rather than guessing', () => {
    // ABC 1234 is also seven characters. The old length-based rule split it
    // as "ABC1 234", which is not a registration anybody would recognise.
    expect(formatRegistration('ABC1234')).toBe('ABC1234');
  });

  it('leaves prefix, suffix and dateless plates alone', () => {
    expect(formatRegistration('A123BCD')).toBe('A123BCD');
    expect(formatRegistration('ABC123D')).toBe('ABC123D');
    expect(formatRegistration('1ABC')).toBe('1ABC');
  });

  it('normalises before deciding, so stored and typed forms agree', () => {
    expect(formatRegistration('  wd21kxr ')).toBe('WD21 KXR');
  });
});
