/**
 * Forecourt's own lint rules.
 *
 * CLAUDE.md describes `pnpm lint` as including "the no-raw-hex and tenant-scope
 * rules". `pnpm lint` had never run — eslint was not installed and there was no
 * config anywhere in the repository — so neither rule existed. This file is the
 * first of the two.
 */

/**
 * Rule 9: no hex colour outside the token files.
 *
 * A hex code in a component is a colour that cannot be themed, cannot be
 * checked for contrast by the token pipeline, and will not follow a dealer's
 * brand. `tokens.json` is the single source, and `theme.ts` turns tokens into
 * CSS custom properties — everything else references the property.
 *
 * Deliberately narrow: it fires on 3-, 4-, 6- and 8-digit hex colours in string
 * literals and templates, not on every `#` in the codebase. A URL fragment, an
 * id selector and a git SHA are not colours, and a rule that flags them gets
 * switched off within a week and then protects nothing.
 */
const HEX_COLOUR = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;

const noRawHex = {
  meta: {
    type: 'problem',
    docs: { description: 'Colours come from tokens.json, never a literal hex code.' },
    schema: [],
    messages: {
      rawHex:
        'Raw hex colour {{hex}}. Colours live in tokens.json and reach the page as a CSS ' +
        'custom property — a literal here cannot be themed and will not follow the dealer\'s brand.',
    },
  },
  create(context) {
    const report = (node, value) => {
      if (typeof value !== 'string') return;
      const match = HEX_COLOUR.exec(value);
      if (match) context.report({ node, messageId: 'rawHex', data: { hex: match[0] } });
    };

    return {
      Literal(node) {
        report(node, node.value);
      },
      TemplateElement(node) {
        report(node, node.value.raw);
      },
    };
  },
};

/**
 * A `'use client'` module may not import the domain barrel.
 *
 * `@forecourt/domain` re-exports everything, including `evidence.ts`, which
 * imports `node:crypto`. Pulling the barrel into a client component fails the
 * webpack build outright — which is the GOOD outcome, and it is how this rule
 * came to be written. The bad outcome is the same mistake with a barrel that
 * happens to bundle: eighty kilobytes of server-side pricing, VAT and
 * compliance logic shipped to a phone on a bad connection, against a JS budget
 * of 120KB for a whole page, with nothing failing to say so.
 *
 * It also leaks. The domain contains the cost and commission calculations; a
 * bundle is readable by anyone, so shipping it to a browser publishes the
 * pricing model to any dealer's customer who opens dev tools.
 *
 * The fix is always the same: import the one module, `@forecourt/domain/leads`,
 * not the barrel. Type-only imports are allowed — they are erased.
 */
const noDomainBarrelInClient = {
  meta: {
    type: 'problem',
    docs: { description: 'Client components import a domain module, never the barrel.' },
    schema: [],
    messages: {
      barrel:
        'A \'use client\' module cannot import the `@forecourt/domain` barrel — it pulls the ' +
        'whole domain (including node:crypto) into the browser bundle. Import the specific ' +
        'module instead — `@forecourt/domain/leads`, `@forecourt/domain/money`.',
    },
  },
  create(context) {
    const source = context.sourceCode ?? context.getSourceCode();

    const isClientModule = () => {
      const body = source.ast.body ?? [];
      for (const statement of body) {
        if (statement.type !== 'ExpressionStatement') break;
        const value = statement.expression?.value;
        if (typeof value !== 'string') break;
        if (value === 'use client') return true;
      }
      return false;
    };

    return {
      ImportDeclaration(node) {
        if (node.source.value !== '@forecourt/domain') return;
        // `import type { X }` is erased at compile time and costs nothing.
        if (node.importKind === 'type') return;
        if (node.specifiers.every((s) => s.importKind === 'type')) return;
        if (!isClientModule()) return;

        context.report({ node, messageId: 'barrel' });
      },
    };
  },
};

export default {
  rules: {
    'no-raw-hex': noRawHex,
    'no-domain-barrel-in-client': noDomainBarrelInClient,
  },
};
