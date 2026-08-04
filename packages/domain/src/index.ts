export * from './money.js';
export * from './vat.js';
export * from './clocks.js';
export * from './permissions.js';
export * from './provisioning.js';
export * from './vehicle-lifecycle.js';
export * from './media.js';
export * from './seo.js';
export * from './structured-data.js';
export * from './finance.js';
export * from './finance-language.js';
export * from './search.js';
export * from './shortlist.js';
export * from './consent.js';
export * from './contacts.js';
export * from './leads.js';
export * from './invoicing.js';
export * from './stock-book.js';
export * from './aml.js';
export * from './evidence.js';
export * from './deals.js';
export * from './appraisal.js';
export * from './auth.js';
export * from './prep.js';

/**
 * Every name above is unique across the barrel, and that is load-bearing:
 * `export *` silently DROPS an ambiguous name rather than failing, so a
 * collision removes the export from this package's public surface with no
 * error anywhere. Four had already done exactly that — `canGoLive`,
 * `SendDecision`, `allowedTransitions` and `TransitionResult` were each
 * exported by two modules and therefore by none. Nothing caught it because
 * `pnpm typecheck` had never run and every test imports from its module
 * directly rather than through here.
 *
 * The losing side of each pair was renamed to say which domain it belongs to
 * (`canTenantGoLive`, `AlertSendDecision`, `allowedLeadTransitions`,
 * `DealTransitionResult`). If you add a module below, a duplicate name is a
 * silent regression — `pnpm typecheck` is now the thing that catches it.
 */
