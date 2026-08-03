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

export default {
  rules: { 'no-raw-hex': noRawHex },
};
