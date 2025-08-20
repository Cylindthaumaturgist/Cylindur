import { TokenTypes } from './lexer.js';
import CaretError from './helpers/CaretError.js';

function ParserError(file, message, line, column, sourceLines) {
  console.log(
    new CaretError(
      'SyntaxError',
      file,
      message,
      line,
      column,
      sourceLines,
      'dark+'
    ).toString()
  );
  process.exit(1);
}

export function Parser(tokens, code, filename = 'unknown.cy') {
  if (!tokens) {
    return null;
  }
  let current = 0;
  let line = tokens[0]?.line || 1;
  let column = tokens[0]?.column || 1;

  const consume = (n = 1) => {
    current += n;
    if (tokens[current]) {
      line = tokens[current].line;
      column = tokens[current].column;
    }
  };

  const ast = [];
  let erred = false;

  function createNode(type, value, loc = {}) {
    return {
      type,
      value,
      loc: {
        start: {
          line: loc.startLine || line,
          column: loc.startColumn || column,
        },
        end: {
          line: loc.endLine || line,
          column: loc.endColumn || column,
        },
      },
    };
  }

  function walk() {
    let token = tokens[current];
    if (!token) return null;

    const startLine = token.line;
    const startColumn = token.column;

    if (token.type === TokenTypes.Number) {
      consume();
      let num = token.value.split('_').join('');
      return createNode('NumberLiteral', num, {
        startLine,
        startColumn,
      });
    }

    if (token.type === TokenTypes.Float) {
      consume();
      return createNode('FloatLiteral', token.value, {
        startLine,
        startColumn,
      });
    }

    if (token.type === TokenTypes.Boolean) {
      consume();
      return createNode('BoolLiteral', token.value, {
        startLine,
        startColumn,
      });
    }

    if (token.type === TokenTypes.Null) {
      consume();
      return createNode('Null', token.value, {
        startLine,
        startColumn,
      });
    }

    if (token.value === '(') {
      consume();
      let expr = parseExpression();
      if (tokens[current]?.value !== ')') {
        const errorLine = line;
        const errorColumn = column;

        ParserError(
          filename,
          `Expected ')'`,
          errorLine,
          errorColumn,
          code.split(/\r?\n/)
        );
      }
      const endToken = tokens[current];
      consume();
      return {
        ...expr,
        loc: {
          start: { line: startLine, column: startColumn },
          end: { line: endToken.line, column: endToken.column },
        },
      };
    }

    if (token.type === TokenTypes.String) {
      consume();
      return createNode('StringLiteral', token.value, {
        startLine,
        startColumn,
      });
    }

    if (token.value === 'null' || token.value === 'undefined') {
      consume();
      return createNode('Null', token.value, {
        startLine,
        startColumn,
      });
    }

    if (token.type === TokenTypes.Identifier) {
      let identifierNode = createNode('Identifier', token.value, {
        startLine,
        startColumn,
				endLine: line,
        endColumn: column,
      });
			consume();
			
      if (tokens[current]?.value === '++' || tokens[current]?.value === '--') {
        const opToken = tokens[current];
        consume();
        identifierNode = {
          type: 'UnaryExpression',
          operator: opToken.value,
          argument: identifierNode,
          prefix: false,
          loc: {
            start: { line: startLine, column: startColumn },
            end: { line: opToken.line, column: opToken.column },
          },
        };
      }

      while (tokens[current]?.value === '.' || tokens[current]?.value === '[') {
        const opToken = tokens[current];
        if (opToken.value === '.') {
          consume();
          if (tokens[current]?.type !== TokenTypes.Identifier) {
            ParserError(
              filename,
              `Expected identifier after dot`,
              tokens[current]?.line || line,
              tokens[current]?.column || column,
              code.split(/\r?\n/)
            );
          }
          const propToken = tokens[current];
          identifierNode = {
            type: 'MemberExpression',
            object: identifierNode,
            property: createNode('Identifier', propToken.value, {
              startLine: propToken.line,
              startColumn: propToken.column,
            }),
            computed: false,
            loc: {
              start: { line: startLine, column: startColumn },
              end: { line: propToken.line, column: propToken.column },
            },
          };
          consume();
        } else if (opToken.value === '[') {
          consume();
          const index = parseExpression();
          if (tokens[current]?.value !== ']') {
            ParserError(
              filename,
              `Expected ']' after index`,
              tokens[current]?.line || line,
              tokens[current]?.column || column,
              code.split(/\r?\n/)
            );
          }
          const endToken = tokens[current];
          consume();
          identifierNode = {
            type: 'MemberExpression',
            object: identifierNode,
            property: index,
            computed: true,
            loc: {
              start: { line: startLine, column: startColumn },
              end: { line: endToken.line, column: endToken.column },
            },
          };
        }
      }

      if (tokens[current]?.value === '(') {
        consume();
        const args = [];
        while (tokens[current]?.value !== ')') {
          if (tokens[current]?.value === ',') {
            consume();
            continue;
          }
          args.push(parseExpression());
        }
        const endToken = tokens[current];
        consume();
        return {
          type: 'CallExpression',
          callee: identifierNode,
          arguments: args,
          loc: {
            start: { line: startLine, column: startColumn },
            end: { line: endToken.line, column: endToken.column },
          },
        };
      }
			
      return identifierNode;
    }

    if (token.value === 'fun') {
      return parseFunctionExpression();
    }

    if (token.value === '[') {
      consume();
      const elements = [];
      while (current < tokens.length && tokens[current].value !== ']') {
        elements.push(parseExpression());
        if (tokens[current]?.value === ',') {
          consume();
        }
      }
      if (tokens[current]?.value !== ']') {
        ParserError(
          filename,
          `Expected ']' to close array`,
          tokens[current]?.line || line,
          tokens[current]?.column || column,
          code.split(/\r?\n/)
        );
      }
      const endToken = tokens[current];
      consume();
      return {
        type: 'ArrayExpression',
        elements,
        loc: {
          start: { line: startLine, column: startColumn },
          end: { line: endToken.line, column: endToken.column },
        },
      };
    }

    if (token.value === '{') {
      consume();
      const properties = [];
      while (current < tokens.length && tokens[current].value !== '}') {
        const keyToken = tokens[current];
        if (
          keyToken.type !== TokenTypes.Identifier &&
          keyToken.type !== TokenTypes.String
        ) {
          const errorLine = line;
          const errorColumn = column;

          ParserError(
            filename,
            `Expected property name`,
            errorLine,
            errorColumn,
            code.split(/\r?\n/)
          );
        }

        const key = keyToken.value;
        consume();

        if (tokens[current]?.value !== ':') {
          ParserError(
            filename,
            `Expected ':' after key in object`,
            tokens[current]?.line || line,
            tokens[current]?.column || column,
            code.split(/\r?\n/)
          );
        }

        consume();

        const value = parseExpression();

        properties.push({
          type: 'Property',
          key,
          value,
          loc: {
            start: { line: keyToken.line, column: keyToken.column },
            end: value.loc.end,
          },
        });

        if (tokens[current]?.value === ',') {
          consume();
        }
      }

      if (tokens[current]?.value !== '}') {
        ParserError(
          filename,
          `Expected '}' to close object`,
          tokens[current]?.line || line,
          tokens[current]?.column || column,
          code.split(/\r?\n/)
        );
      }
      const endToken = tokens[current];
      consume();

      return {
        type: 'ObjectExpression',
        properties,
        loc: {
          start: { line: startLine, column: startColumn },
          end: { line: endToken.line, column: endToken.column },
        },
      };
    }

    const errorLine = line;
    const errorColumn = column;

    ParserError(
      filename,
      `Unexpected token: ${token.value}`,
      errorLine,
      errorColumn - token.value.length,
      code.split(/\r?\n/)
    );
    erred = true;
    consume();
  }

  function getPrecedence(op) {
    return (
      {
        ['==']: 1,
        ['===']: 1,
        ['!=']: 1,
        ['!==']: 1,
        ['&&']: 1,
        ['||']: 1,
        ['<']: 2,
        ['>']: 2,
        ['<=']: 2,
        ['>=']: 2,
        ['+']: 2,
        ['-']: 2,
        ['*']: 3,
        ['/']: 3,
        ['%']: 3,
        ['**']: 4,
      }[op] || 0
    );
  }

  function parseBinaryExpression(left, minPrecedence = 0) {
    while (current < tokens.length) {
      let token = tokens[current];
      let precedence = getPrecedence(token.value);
      if (precedence === 0 || precedence < minPrecedence) {
        break;
      }

      const operatorToken = token;
      consume();

      let right = walk();
      let nextPrecedence = getPrecedence(tokens[current]?.value);
      if (precedence < nextPrecedence) {
        right = parseBinaryExpression(right, precedence + 1);
      }

      left = {
        type: 'BinaryExpression',
        operator: operatorToken.value,
        left,
        right,
        loc: {
          start: left.loc.start,
          end: right.loc.end,
        },
      };
    }
    return left;
  }

  function parseVariableDeclaration() {
    const startToken = tokens[current];
    let kind = tokens[current].value === 'const' ? 'Constant' : 'Changeable';
    consume();

    if (tokens[current]?.type !== TokenTypes.Identifier) {
      const errorLine = line;
      const errorColumn = column;

      ParserError(
        filename,
        `Expected a variable name`,
        errorLine,
        errorColumn + 2,
        code.split(/\r?\n/)
      );
    }

    let id = walk();
    let typeAnnotation = null;

    if (tokens[current]?.value === ':') {
      consume();
      if (tokens[current]?.type !== TokenTypes.Identifier) {
        const errorLine = line;
        const errorColumn = column;

        ParserError(
          filename,
          `Expected variable type after ':'`,
          errorLine,
          errorColumn,
          code.split(/\r?\n/)
        );
      }
      typeAnnotation = {
        type: 'TypeAnnotation',
        annotation: tokens[current].value,
        loc: {
          start: { line: tokens[current].line, column: tokens[current].column },
        },
      };
      consume();
    } else {
      if (tokens[current]?.value !== '=') {
        const errorLine = line;
        const errorColumn = column;
        let additive = 0;
        if (tokens[current - 1]?.type === 'identifier') {
          additive = tokens[current - 1].value.length - 1;
        }

        ParserError(
          filename,
          `Expected '=' after variable name`,
          errorLine,
          errorColumn + additive,
          code.split(/\r?\n/)
        );
      }
      typeAnnotation = {
        type: 'TypeAnnotation',
        annotation: 'Any',
        loc: {
          start: { line: line, column: column },
        },
      };
    }

    consume();
    let init = parseExpression();
    if (!init) {
      const errorLine = line;
      const errorColumn = column;

      ParserError(
        filename,
        `Expected variable value after '='`,
        errorLine,
        errorColumn,
        code.split(/\r?\n/)
      );
    }
    if (init?.type === 'AssignmentExpression') init = init.right;

    if (tokens[current]?.value !== ';') {
			console.log(init)
      const errorLine = init?.loc?.end?.line ?? line;
      const errorColumn = init?.loc?.end?.column ?? column;
      if (current > tokens.length - 1) {
        current = tokens.length - 1;
      }
      let additive = 0;
			let subLine = 0;
      if (
        tokens[current - 1]?.value === ':' &&
        tokens[current]?.type === 'identifier'
      ) {
        additive = tokens[current].value.length - 1;
      } else if (tokens[current]?.type === 'identifier') {
        additive = tokens[current].value.length + 1;
      } else if (init?.type === 'StringLiteral') {
        additive = init?.value.length + 1;
      } 
			
      ParserError(
        filename,
        `Expected ';' after variable declaration`,
        errorLine + subLine,
        errorColumn + additive,
        code.split(/\r?\n/)
      );
    }
    const endToken = tokens[current];
    consume();

    if (typeAnnotation) {
      typeAnnotation.loc.end = { line: endToken.line, column: endToken.column };
    }

    return {
      type: 'VariableDeclaration',
      kind,
      declarations: [
        {
          type: 'VariableDeclarator',
          id,
          ...(typeAnnotation ? { typeAnnotation } : {}),
          init,
          loc: {
            start: { line: startToken.line, column: startToken.column },
            end: init.loc.end,
          },
        },
      ],
      loc: {
        start: { line: startToken.line, column: startToken.column },
        end: { line: endToken.line, column: endToken.column },
      },
    };
  }

  function parseFunction(isDeclaration) {
    const startToken = tokens[current];
    consume();

    let id = null;
    if (isDeclaration) {
      if (tokens[current]?.type !== 'identifier') {
        const errorLine = line;
        const errorColumn = column;

        ParserError(
          filename,
          `Expected function name`,
          errorLine,
          errorColumn + 2,
          code.split(/\r?\n/)
        );
      }
      id = createNode('identifier', tokens[current]?.value);
      consume();
    } else {
      if (tokens[current]?.type === 'identifier') {
        id = createNode('identifier', tokens[current]?.value);
        consume();
      }
    }

    if (tokens[current]?.value !== '(') {
      const errorLine = line;
      const errorColumn = column;

      ParserError(
        filename,
        `Expected '(' after function ${
          isDeclaration ? 'declaration' : 'expression'
        }`,
        errorLine,
        errorColumn + tokens[current - 1]?.value.length - 1,
        code.split(/\r?\n/)
      );
    }
    consume();

    let params = [];
    while (current < tokens.length && tokens[current]?.value !== ')') {
      if (tokens[current]?.value === ',') {
        consume();
        continue;
      }

      let paramNameToken = tokens[current];
      if (paramNameToken.type !== 'identifier') {
        const errorLine = line;
        const errorColumn = column;

        ParserError(
          filename,
          `Expected parameter name to be an Identifier`,
          errorLine,
          errorColumn - 1,
          code.split(/\r?\n/)
        );
      }
      consume();

      let param = {
        name: paramNameToken.value,
        type: 'Any',
        loc: {
          start: { line: paramNameToken.line, column: paramNameToken.column },
        },
      };

      if (tokens[current]?.value === ':') {
        consume();
        if (tokens[current]?.type !== 'identifier') {
          const errorLine = line;
          const errorColumn = column;

          ParserError(
            filename,
            `Expected type after colon`,
            errorLine,
            errorColumn,
            code.split(/\r?\n/)
          );
        }
        param.type = tokens[current].value;
        param.loc.end = {
          line: tokens[current].line,
          column: tokens[current].column,
        };
        consume();
      } else {
        param.loc.end = {
          line: paramNameToken.line,
          column: paramNameToken.column,
        };
      }

      params.push(param);

      if (tokens[current]?.value === ',') {
        consume();
      }
    }

    if (tokens[current]?.value !== ')') {
      const errorLine = line;
      const errorColumn = column;
      let additive = 0;
      if (tokens[current - 1]?.type === 'identifier') {
        additive = tokens[current - 1].value.length - 1;
      }

      ParserError(
        filename,
        `Expected ')' after function parameters`,
        errorLine,
        errorColumn + additive,
        code.split(/\r?\n/)
      );
    }
    consume();

    let returnType = 'Any';
    if (tokens[current]?.value === '->') {
      consume();
      if (tokens[current]?.type !== TokenTypes.Identifier) {
        const errorLine = line;
        const errorColumn = column;

        ParserError(
          filename,
          `Expected a return type after '->'`,
          errorLine,
          errorColumn + 1,
          code.split(/\r?\n/)
        );
      }
      let typeToken = tokens[current];
      returnType = typeToken.value;
      consume();
    }

    if (tokens[current]?.value !== '{') {
      const errorLine = line;
      const errorColumn = column;
      let additive = 0;
      if (tokens[current - 1]?.type === 'identifier') {
        additive = tokens[current - 1].value.length - 1;
      }

      ParserError(
        filename,
        `Expected '{' before function body`,
        errorLine,
        errorColumn + additive,
        code.split(/\r?\n/)
      );
    }
    consume();

    let body = [];
    while (current < tokens.length && tokens[current]?.value !== '}') {
      body.push(parseStatement());
    }

    if (tokens[current]?.value !== '}') {
      const errorLine = line;
      const errorColumn = column;

      ParserError(
        filename,
        `Expected '}' after function body`,
        errorLine,
        errorColumn,
        code.split(/\r?\n/)
      );
    }
    const endToken = tokens[current];
    consume();

    return {
      type: isDeclaration ? 'FunctionDeclaration' : 'FunctionExpression',
      id,
      params,
      returnType,
      body,
      loc: {
        start: { line: startToken.line, column: startToken.column },
        end: { line: endToken.line, column: endToken.column },
      },
    };
  }

  function parseFunctionDeclaration() {
    return parseFunction(true);
  }

  function parseFunctionExpression() {
    return parseFunction(false);
  }

  function parseIfElse() {
    const startToken = tokens[current];
    consume();

    if (tokens[current]?.value !== '(') {
      const errorLine = line;
      const errorColumn = column;

      ParserError(
        filename,
        `Expected '(' before if condition`,
        errorLine,
        errorColumn + 1,
        code.split(/\r?\n/)
      );
    }
    consume();

    const test = parseExpression();
    if (!test) {
      const errorLine = line;
      const errorColumn = column;

      ParserError(
        filename,
        `Expected a condition inside if condition`,
        errorLine,
        errorColumn,
        code.split(/\r?\n/)
      );
    }
		console.log(test)

    if (tokens[current]?.value !== ')') {
      const errorLine = line;
      const errorColumn = column;

      ParserError(
        filename,
        `Expected ')' after if condition`,
        errorLine,
        errorColumn,
        code.split(/\r?\n/)
      );
    }
    consume();

    if (tokens[current]?.value !== '{') {
      const errorLine = line;
      const errorColumn = column;

      ParserError(
        filename,
        `Expected '{' before if body`,
        errorLine,
        errorColumn,
        code.split(/\r?\n/)
      );
    }
    consume();

    const consequentBody = [];
    while (tokens[current]?.value !== '}') {
      if (current >= tokens.length) break;
      consequentBody.push(parseStatement());
    }

    if (tokens[current]?.value !== '}') {
      const errorLine = line;
      const errorColumn = column;
      let additives = 0;

      ParserError(
        filename,
        `Expected a '}' after if body`,
        errorLine,
        errorColumn,
        code.split(/\r?\n/)
      );
    }
    consume();

    const consequent = {
      type: 'BlockStatement',
      body: consequentBody,
      loc: {
        start: test.loc.end,
        end: {
          line: tokens[current - 1]?.line,
          column: tokens[current - 1]?.column,
        },
      },
    };

    let alternate = null;
    if (tokens[current]?.value === 'else') {
      const elseToken = tokens[current];
      consume();

      if (tokens[current]?.value === 'if') {
        alternate = parseIfElse();
        alternate.loc.start = {
          line: elseToken.line,
          column: elseToken.column,
        };
      } else {
        if (tokens[current]?.value !== '{') {
          const errorLine = line;
          const errorColumn = column;

          ParserError(
            filename,
            `Expected '{' before else`,
            errorLine,
            errorColumn,
            code.split(/\r?\n/)
          );
        }
        consume();

        const alternateBody = [];
        while (tokens[current]?.value !== '}') {
          alternateBody.push(parseStatement());
        }
        const endToken = tokens[current];
        consume();

        alternate = {
          type: 'BlockStatement',
          body: alternateBody,
          loc: {
            start: { line: elseToken.line, column: elseToken.column },
            end: { line: endToken.line, column: endToken.column },
          },
        };
      }
    }

    return {
      type: 'IfStatement',
      test,
      consequent,
      alternate,
      loc: {
        start: { line: startToken.line, column: startToken.column },
        end: alternate ? alternate.loc.end : consequent.loc.end,
      },
    };
  }

  function parseForLoop() {
    const startToken = tokens[current];
    consume();

    if (tokens[current]?.value !== '(') {
      const errorLine = line;
      const errorColumn = column;

      ParserError(
        filename,
        `Expected a condition inside if condition body`,
        errorLine,
        errorColumn,
        code.split(/\r?\n/)
      );
    }
    consume();

    let init = null;
    if (tokens[current]?.value === 'var') {
      init = parseVariableDeclaration();
    } else if (tokens[current]?.value !== ';') {
      init = parseExpression();
    }

    let test = null;
    if (tokens[current]?.value !== ';') {
      test = parseExpression();
    } else {
      test = {
        type: 'BoolLiteral',
        value: true,
        loc: {
          start: { line: line, column: column },
          end: { line: line, column: column },
        },
      };
    }

    if (tokens[current]?.value !== ';') {
      throw new Error(`Expected ';' after for loop test at ${line}:${column}`);
    }
    consume();

    let update = null;
    if (tokens[current]?.value !== ')') {
      update = parseExpression();
    }

    if (tokens[current]?.value !== ')') {
      throw new Error(
        `Expected ')' after for loop update at ${line}:${column}`
      );
    }
    consume();

    if (tokens[current]?.value !== '{') {
      throw new Error(`Expected '{' before for loop body at ${line}:${column}`);
    }
    consume();

    const body = [];
    while (tokens[current]?.value !== '}') {
      body.push(parseStatement());
    }
    const endToken = tokens[current];
    consume();

    return {
      type: 'ForStatement',
      init,
      test,
      update,
      body: {
        type: 'BlockStatement',
        body: body,
        loc: {
          start: { line: line, column: column },
          end: { line: endToken.line, column: endToken.column },
        },
      },
      loc: {
        start: { line: startToken.line, column: startToken.column },
        end: { line: endToken.line, column: endToken.column },
      },
    };
  }

  function parseWhileLoop() {
    const startToken = tokens[current];
    consume();
    let parenthesis = 0;

    if (tokens[current]?.value !== '(') {
      const errorLine = line;
      const errorColumn = column + 4;
      parenthesis = column;

      ParserError(
        filename,
        `Expected '(' after 'while'`,
        errorLine,
        errorColumn,
        code.split(/\r?\n/)
      );
    }

    consume();
    const test = parseExpression();
    if (!test) {
      const errorLine = line;
      const errorColumn = column;

      ParserError(
        filename,
        `Expected a condition inside while condition`,
        errorLine,
        errorColumn,
        code.split(/\r?\n/)
      );
    }

    if (tokens[current]?.value !== ')') {
      const errorLine = test?.loc?.end?.line ?? line;
      const errorColumn = test?.loc?.end?.column ?? column;
      let additives = 1;

      if (test?.type === 'BoolLiteral') {
        additives = test.value.toString().length - 1;
      }
      ParserError(
        filename,
        `Expected ')' after while condition`,
        errorLine,
        errorColumn + additives,
        code.split(/\r?\n/)
      );
    }
    consume();

    if (tokens[current]?.value !== '{') {
      const errorLine = test?.loc?.end?.line ?? line;
      const errorColumn = test?.loc?.end?.column ?? column;
      let additives = 2;

      if (test?.type === 'BoolLiteral') {
        additives = test.value.toString().length;
      }
      ParserError(
        filename,
        `Expected '{' before while loop body`,
        errorLine,
        errorColumn + additives,
        code.split(/\r?\n/)
      );
    }
    consume();

    const body = [];
    while (tokens[current]?.value !== '}') {
      if (current >= tokens.length) break;
      body.push(parseStatement());
    }

    if (tokens[current]?.value !== '}') {
      const errorLine = line;
      const errorColumn = column;
      let additives = 0;

      ParserError(
        filename,
        `Expected a '}' after while body`,
        errorLine,
        errorColumn,
        code.split(/\r?\n/)
      );
    }

    const endToken = tokens[current];
    consume();

    return {
      type: 'WhileStatement',
      test,
      body: {
        type: 'BlockStatement',
        body: body,
        loc: {
          start: { line: line, column: column },
          end: { line: endToken.line, column: endToken.column },
        },
      },
      loc: {
        start: { line: startToken.line, column: startToken.column },
        end: { line: endToken.line, column: endToken.column },
      },
    };
  }

  function parseExpression() {
    const startToken = tokens[current];
    let expr = walk();
    expr = parseBinaryExpression(expr, 0);
    const assignmentOps = ['=', '+=', '-=', '*=', '/=', '%=', '**='];

    if (
      current < tokens.length &&
      assignmentOps.includes(tokens[current]?.value) &&
      expr.type !== 'TypeAnnotation'
    ) {
      const operatorToken = tokens[current];
      consume();
      const right = parseExpression();
      expr = {
        type: 'AssignmentExpression',
        operator: operatorToken.value,
        left: expr,
        right,
        loc: {
          start: { line: startToken.line, column: startToken.column },
          end: right.loc.end,
        },
      };
    }

    if (
      tokens[current]?.value === '++' &&
      tokens[current + 1]?.type === TokenTypes.Identifier
    ) {
      consume();
      let identifierToken = tokens[current];
      consume();

      expr = {
        type: 'UnaryExpression',
        operator: '++',
        argument: {
          type: 'Identifier',
          value: identifierToken.value,
          loc: {
            start: {
              line: identifierToken.line,
              column: identifierToken.column,
            },
            end: { line: identifierToken.line, column: identifierToken.column },
          },
        },
        prefix: true,
        loc: {
          start: { line: startToken.line, column: startToken.column },
          end: { line: identifierToken.line, column: identifierToken.column },
        },
      };
    }
    return expr;
  }

  function parseStatement() {
    const startToken = tokens[current];

    if (
      tokens[current]?.value === 'var' ||
      tokens[current]?.value === 'const'
    ) {
      return parseVariableDeclaration();
    }

    if (tokens[current]?.value === 'fun') {
      return parseFunctionDeclaration();
    }

    if (tokens[current]?.value === 'if') {
      return parseIfElse();
    }

    if (tokens[current]?.value === 'for') {
      return parseForLoop();
    }

    if (tokens[current]?.value === 'while') {
      return parseWhileLoop();
    }

    if (tokens[current]?.value === 'return') {
      consume();
      let returnExpr = parseExpression();
      if (tokens[current]?.value !== ';') {
        const errorLine = returnExpr.loc.end.line;
        const errorColumn = returnExpr.loc.end.column;
        ParserError(
          filename,
          `Expected ';' after return statement`,
          errorLine,
          errorColumn + 1,
          code.split(/\r?\n/)
        );
      }
      const endToken = tokens[current];
      consume();
      return {
        type: 'ReturnStatement',
        argument: returnExpr,
        loc: {
          start: { line: startToken.line, column: startToken.column },
          end: { line: endToken.line, column: endToken.column },
        },
      };
    }

    if (tokens[current]?.value === 'include') {
      return parseIncludeLibrary();
    }

    if (tokens[current]?.value === 'alias') {
      return parseAliasDeclaration();
    }

    let expr = walk();

    if (tokens[current]?.value === '=') {
      const operatorToken = tokens[current];
      consume();
      let value = parseExpression();
      if (tokens[current]?.value !== ';') {
        const errorLine = value.loc.end.line;
        const errorColumn = value.loc.end.column;
        ParserError(
          filename,
          `Expected ';' after assignment expression`,
          errorLine,
          errorColumn + (value?.value?.length ?? 0) + 1,
          code.split(/\r?\n/)
        );
      }
      const endToken = tokens[current];
      consume();
      return {
        type: 'AssignmentExpression',
        operator: operatorToken.value,
        left: expr,
        right: value,
        loc: {
          start: { line: startToken.line, column: startToken.column },
          end: { line: endToken.line, column: endToken.column },
        },
      };
    }

    const assignmentOperators = ['+=', '-=', '*=', '/=', '**=', '%='];

    if (assignmentOperators.includes(tokens[current]?.value)) {
      const operatorToken = tokens[current];
      consume();
      let value = parseExpression();

      let isPureAssignment = value.type === 'BinaryExpression';
      if (tokens[current]?.value !== ';') {
        const errorLine = value.loc.end.line;
        const errorColumn = value.loc.end.column;
        ParserError(
          filename,
          `Expected ';' after ${operatorToken.value} assignment`,
          errorLine,
          errorColumn + (isPureAssignment ? 3 : 2),
          code.split(/\r?\n/)
        );
      }
      const endToken = tokens[current];
      consume();
      return {
        type: 'AssignmentExpression',
        operator: operatorToken.value,
        left: expr,
        right: value,
        loc: {
          start: { line: startToken.line, column: startToken.column },
          end: { line: endToken.line, column: endToken.column },
        },
      };
    }

    if (tokens[current]?.value === ';') {
      const endToken = tokens[current];
      consume();
      return {
        type: 'ExpressionStatement',
        expression: expr,
        loc: {
          start: { line: startToken.line, column: startToken.column },
          end: { line: endToken.line, column: endToken.column },
        },
      };
    } else {
      const errorLine = expr?.loc?.end?.line ?? line;
      let errorColumn = expr?.loc?.end?.column ?? column;
      let additive = 0;
      let addLine = 0;
      if (expr?.type === 'MemberExpression') {
        additive = expr.property.value.length - 1;
      } else if (expr?.type === 'ArrayExpression') {
        additive = expr.elements.length > 0 ? expr.elements.length : 1;
      } else if (expr?.type === 'ObjectExpression') {
        additive = expr.properties.length > 0 ? expr.properties.length : 1;
      } else if (expr?.type === 'UnaryExpression') {
        additive = expr.operator.length > 0 ? expr.operator.length : 1;
      } else if (expr?.type === 'Identifier') {
        errorColumn = (expr.value.length ?? 0) + 1;
      } else if (expr?.type === 'CallExpression') {
        additive = 0;
      }
      ParserError(
        filename,
        `Expected ';' after expression${
          tokens[current] ? ' but got ' + tokens[current].value : ''
        }`,
        errorLine + addLine,
        errorColumn + additive,
        code.split(/\r?\n/)
      );
    }
  }

  function parseIncludeLibrary() {
    const startToken = tokens[current];
    consume();

    let library = null;
    let isBuiltin = false;
    let directory = null;

    if (tokens[current]?.value === '#') {
      isBuiltin = true;
      consume();

      if (tokens[current]?.value !== '<') {
        ParserError(
          filename,
          `Expected '<' after '#' in include`,
          tokens[current]?.line || line,
          (tokens[current]?.column || column) + 1,
          code.split(/\r?\n/)
        );
      }
      consume();

      if (tokens[current]?.type !== TokenTypes.Identifier) {
        ParserError(
          filename,
          `Expected library name after '<' in built-in include`,
          tokens[current]?.line || line,
          (tokens[current]?.column || column) - 1,
          code.split(/\r?\n/)
        );
      }

      library = tokens[current]?.value;
      consume();

      if (tokens[current]?.value !== '>') {
        ParserError(
          filename,
          `Expected '>' after library name`,
          tokens[current]?.line || line,
          (tokens[current]?.column || column) + (library?.length ?? 1),
          code.split(/\r?\n/)
        );
      }
      consume();

      if (tokens[current]?.value !== ';') {
        ParserError(
          filename,
          `Expected ';' after built-in include`,
          tokens[current]?.line || line,
          (tokens[current]?.column || column) + 1,
          code.split(/\r?\n/)
        );
      }
      const endToken = tokens[current];
      consume();

      return {
        type: 'IncludeExpression',
        isBuiltin,
        library,
        loc: {
          start: { line: startToken.line, column: startToken.column },
          end: { line: endToken.line, column: endToken.column },
        },
      };
    } else {
      if (tokens[current]?.value !== '<') {
        ParserError(
          filename,
          `Expected '<' after include keyword`,
          tokens[current]?.line || line,
          (tokens[current]?.column || column) + 7,
          code.split(/\r?\n/)
        );
      }
      consume();

      if (tokens[current]?.type !== TokenTypes.Identifier) {
        ParserError(
          filename,
          `Expected library name after '<' in custom include`,
          tokens[current]?.line || line,
          (tokens[current]?.column || column) + 1,
          code.split(/\r?\n/)
        );
      }

      library = tokens[current]?.value;
      consume();

      if (tokens[current]?.value !== '>') {
        ParserError(
          filename,
          `Expected '>' after library name`,
          tokens[current]?.line || line,
          (tokens[current]?.column || column) + (library?.length ?? 1),
          code.split(/\r?\n/)
        );
      }
      consume();

      if (tokens[current]?.value !== 'from') {
        ParserError(
          filename,
          `Expected 'from' after custom library include`,
          tokens[current]?.line || line,
          (tokens[current]?.column || column) + 1,
          code.split(/\r?\n/)
        );
      }
      consume();

      if (!tokens[current] || tokens[current].type !== 'string') {
        ParserError(
          filename,
          `Expected file path string after 'from'`,
          tokens[current]?.line || line,
          (tokens[current]?.column || column) + 4,
          code.split(/\r?\n/)
        );
      }
      directory = tokens[current].value;
      consume();

      if (tokens[current]?.value !== ';') {
        ParserError(
          filename,
          `Expected ';' after custom include`,
          tokens[current]?.line || line,
          (tokens[current]?.column || column) + directory.length + 2,
          code.split(/\r?\n/)
        );
      }
      const endToken = tokens[current];
      consume();

      return {
        type: 'IncludeExpression',
        isBuiltin,
        library,
        directory,
        loc: {
          start: { line: startToken.line, column: startToken.column },
          end: { line: endToken.line, column: endToken.column },
        },
      };
    }
  }

  function parseAliasDeclaration() {
    const startToken = tokens[current];
    consume();
    let id = walk();

    if (tokens[current]?.value !== '=') {
      ParserError(
        filename,
        `Expected '=' after alias id`,
        tokens[current]?.line || line,
        tokens[current]?.column || column,
        code.split(/\r?\n/)
      );
    }
    consume();

    let typeValue;
    const token = tokens[current];

    if (!token) {
      ParserError(
        filename,
        `Unexpected end of input in alias declaration`,
        tokens[current]?.line || line,
        tokens[current]?.column || column,
        code.split(/\r?\n/)
      );
    }

    switch (token.value) {
      case '{':
        typeValue = parseObjectType();
        break;
      case '[':
        typeValue = parseArrayType();
        break;
      default:
        if (token.type === TokenTypes.Identifier) {
          typeValue = {
            type: 'TypeIdentifier',
            value: token.value,
            loc: {
              start: { line: token.line, column: token.column },
              end: { line: token.line, column: token.column },
            },
          };
          consume();
        } else {
          ParserError(
            filename,
            `Unexpected token in alias`,
            tokens[current]?.line || line,
            tokens[current]?.column || column,
            code.split(/\r?\n/)
          );
        }
    }

    return {
      type: 'AliasDeclaration',
      id,
      typeValue,
      loc: {
        start: { line: startToken.line, column: startToken.column },
        end: typeValue.loc.end,
      },
    };
  }

  function parseObjectType() {
    const startToken = tokens[current];
    consume();
    const properties = [];

    while (tokens[current]?.value !== '}') {
      const key = walk();
      consume();
      const type = walk();
      properties.push({
        key,
        type,
        loc: {
          start: key.loc.start,
          end: type.loc.end,
        },
      });
      if (tokens[current]?.value === ',') consume();
    }

    const endToken = tokens[current];
    consume();

    return {
      type: 'ObjectType',
      properties,
      loc: {
        start: { line: startToken.line, column: startToken.column },
        end: { line: endToken.line, column: endToken.column },
      },
    };
  }

  function parseArrayType() {
    const startToken = tokens[current];
    consume();
    const elements = [];

    while (tokens[current]?.value !== ']') {
      elements.push(walk());
      if (tokens[current]?.value === ',') consume();
    }

    const endToken = tokens[current];
    consume();

    return {
      type: 'ArrayType',
      elements,
      loc: {
        start: { line: startToken.line, column: startToken.column },
        end: { line: endToken.line, column: endToken.column },
      },
    };
  }

  while (current < tokens.length) {
    const stmt = parseStatement();
    ast.push(stmt);
  }

  return !erred
    ? {
        type: 'Program',
        body: ast,
        loc: {
          start: { line: 1, column: 1 },
          end:
            tokens.length > 0
              ? {
                  line: tokens[tokens.length - 1].line,
                  column: tokens[tokens.length - 1].column,
                }
              : { line: 1, column: 1 },
        },
      }
    : null;
}
