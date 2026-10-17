import { relative, sep } from 'node:path';
import ts from 'typescript';

/*
 * drashti/text-cut (Sessions 31–36, I18N-5): words are cut with cutText (src/shared/text.ts), which never
 * splits a letter. `.slice(0, n)`, `.substring(0, n)` or `.substr(0, n)` on a string counts UTF-16 units and
 * can cut a Gujarati or Hindi conjunct (ક્ષ, क्ष), a vowel sign or an emoji in two. The receiver's type
 * decides (an array's slice is fine). Ids and codes (a colour, a time, a hash, a pairing code) and cuts at a
 * character the code found (an extension's dot, a newline) are allowed by name in eslint.config.mjs:
 * `allow` lists each as [file, the call's text, why]. src/main/text-cut-lint.test.ts plants one.
 */

const CUTS = new Set(['slice', 'substring', 'substr']);

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Cut words with cutText, never by UTF-16 units' },
    schema: [
      {
        type: 'object',
        properties: {
          allow: {
            type: 'array',
            items: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      cut: 'Cut words with cutText (src/shared/text.ts): {{call}} can split a letter (ક્ષ, क्ष). An id or a code: allow it by name in eslint.config.mjs (drashti/text-cut).',
    },
  },
  create(context) {
    const services = context.sourceCode.parserServices;
    if (!services?.program || !services.esTreeNodeToTSNodeMap) return {};
    const checker = services.program.getTypeChecker();
    const file = relative(context.cwd, context.filename).split(sep).join('/');
    /** @type {string[][]} */
    const allowed = (context.options[0]?.allow ?? []).filter(([f]) => f === file);
    /** @param {ts.Type} type */
    const isText = (type) => {
      const t = checker.getNonNullableType(type);
      if ((t.flags & ts.TypeFlags.StringLike) !== 0) return true;
      return t.isUnion() && t.types.every((u) => (u.flags & ts.TypeFlags.StringLike) !== 0);
    };
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier')
          return;
        if (!CUTS.has(callee.property.name)) return;
        const [first] = node.arguments;
        if (first?.type !== 'Literal' || first.value !== 0) return;
        const object = services.esTreeNodeToTSNodeMap.get(callee.object);
        if (!isText(checker.getTypeAtLocation(object))) return;
        const text = context.sourceCode.getText(node);
        if (allowed.some(([, call]) => text.includes(call))) return;
        context.report({ node, messageId: 'cut', data: { call: `.${callee.property.name}(0, …)` } });
      },
    };
  },
};
