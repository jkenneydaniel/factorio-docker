// Feature controllers may create small DOM primitives, but page/row/form markup
// belongs to reviewed HTML templates. Keep the boundary enforceable as packages
// are added, rather than relying on every author remembering the convention.
export const nativeTemplates = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      markup:
        'Put application markup in an HTML template and assign instance values through DOM properties.',
      sink: 'Render application template nodes with append/replaceChildren instead of parsing HTML in a capability controller.',
    },
  },
  create(context) {
    const markup = /<\/?[a-z][a-z0-9:-]*(?:\s|>|\/)/i;
    const check = (node, value) => {
      if (typeof value === 'string' && markup.test(value))
        context.report({node, messageId: 'markup'});
    };
    return {
      Literal(node) {
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked);
      },
      AssignmentExpression(node) {
        const member = node.left;
        if (
          member.type === 'MemberExpression' &&
          ['innerHTML', 'outerHTML'].includes(
            member.computed ? member.property.value : member.property.name,
          )
        )
          context.report({node, messageId: 'sink'});
      },
      CallExpression(node) {
        const member = node.callee;
        if (
          member.type === 'MemberExpression' &&
          ['insertAdjacentHTML', 'createContextualFragment'].includes(
            member.computed ? member.property.value : member.property.name,
          )
        )
          context.report({node, messageId: 'sink'});
      },
    };
  },
};
