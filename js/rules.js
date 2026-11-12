// Federal loan terms used for every projection. Each one is an assumption the
// page shows and lets you change, not a fact about any particular letter.
// Sources: Federal Student Aid electronic announcement GENERAL-26-33 (rates for
// loans first disbursed July 1, 2026 to June 30, 2027) and studentaid.gov.

export const RULES = {
  year: '2026–27',
  rates: {
    sub: 0.0652, // Direct Subsidized, undergraduate
    unsub: 0.0652, // Direct Unsubsidized, undergraduate
    plus: 0.0907, // Direct PLUS for parents
    private: 0.09, // no federal rate exists; a placeholder you should replace
  },
  fees: {
    sub: 0.01057,
    unsub: 0.01057,
    plus: 0.04228,
    private: 0,
  },
  // Annual Direct Loan limits for a dependent undergraduate, by year in school.
  directLimit: [5500, 6500, 7500, 7500],
  subLimit: [3500, 4500, 5500, 5500],
  parentPlusAnnualCap: 20000,
  repaymentMonths: 120, // standard 10-year plan
  graceMonths: 6,
};

export const CATEGORY = {
  gift: 'Gift aid',
  loan: 'Loan',
  work: 'Work-study',
  cost: 'Cost',
  info: 'Not counted',
};

export const LOAN_KIND = {
  sub: 'Federal Direct Subsidized',
  unsub: 'Federal Direct Unsubsidized',
  plus: 'Parent PLUS',
  private: 'Private loan',
};
