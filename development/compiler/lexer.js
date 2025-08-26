import CaretError from './helpers/CaretError.js';

export const TokenTypes = {
  Keyword: 'keyword',
  Symbol: 'symbol',
  Identifier: 'identifier',
  Number: 'number',
  Boolean: 'boolean',
  Float: 'float',
  Operation: 'operation',
  String: 'string',
  Null: 'null',
};

function LexerError(file, message, line, column, sourceLines) {
  console.log(
    new CaretError(
      'TokenError',
      file,
      message,
      line,
      column,
      sourceLines
    ).toString()
  );
  process.exit(1);
}

export function Lexer(code, filename = 'unknown.cy') {
  if (!code) return null;
  const tokens = [];
  let position = 0;
  let line = 1;
  let column = 1;
  const keywords = [
    'const',
    'var',
    'fun',
    'while',
    'if',
    'else',
    'cases',
    'for',
    'return',
    'alias',
    'enum',
    'typeof',
    'null',
    'undefined',
    'include',
  ];

  const operations = ['+', '-', '*', '/', '<', '>', '%'];
  const symbols = [
    '_',
    ';',
    ':',
    ',',
    '.',
    '(',
    ')',
    '[',
    ']',
    '{',
    '}',
    '!',
    '?',
    '&',
    '|',
    '#',
  ];

  function nextChar(a = 0) {
    return code[position + a];
  }
  function advance(num = 1) {
    for (let i = 0; i < num; i++) {
      if (code[position] === '\n') {
        line++;
        column = 2;
      } else {
        column++;
      }
      position++;
    }
  }
  function isDigit(char) {
    return char >= '0' && char <= '9';
  }
  function isWSpace(char) {
    return char === ' ' || char === '\n' || char === '\t' || char === '\r';
  }
  function isLetter(a) {
    return (a >= 'a' && a <= 'z') || (a >= 'A' && a <= 'Z') || a === '_';
  }
  function isBoolean(a) {
    return a === 'true' || a === 'false';
  }
  function isFloat(value) {
    return /^-?\d+\.\d+$/.test(value);
  }
  while (position < code.length) {
    if (isWSpace(nextChar())) {
      advance();
      continue;
    }
    const char = nextChar();

    const tokenLine = line;
    const tokenColumn = column;

    if (isDigit(char)) {
      let num = char;
      advance();
      while (isDigit(nextChar()) || nextChar() === '.') {
        num += nextChar();
        advance();
      }
      tokens.push({
        type: isFloat(num) ? TokenTypes.Float : TokenTypes.Number,
        value: num,
        line: tokenLine,
        column: tokenColumn,
      });
    } else if (isLetter(char)) {
      let word = char;
      advance();
      while (isLetter(nextChar()) || isDigit(nextChar())) {
        word += nextChar();
        advance();
      }
      let tokenType;
      if (keywords.includes(word)) {
        tokenType = TokenTypes.Keyword;
      } else if (isBoolean(word)) {
        tokenType = TokenTypes.Boolean;
        word = word === 'true';
      } else {
        tokenType = TokenTypes.Identifier;
      }
      tokens.push({
        type: tokenType,
        value: word,
        line: tokenLine,
        column: tokenColumn,
      });
    } else if (operations.includes(char)) {
      if (char === '+') {
        if (nextChar(1) === '=') {
          tokens.push({
            type: TokenTypes.Operation,
            value: '+=',
            line: tokenLine,
            column: tokenColumn,
          });
          advance(2);
        } else if (nextChar(1) === '+') {
          tokens.push({
            type: TokenTypes.Operation,
            value: '++',
            line: tokenLine,
            column: tokenColumn,
          });
          advance(2);
        } else {
          tokens.push({
            type: TokenTypes.Operation,
            value: '+',
            line: tokenLine,
            column: tokenColumn,
          });
          advance(1);
        }
      } else if (char === '-') {
        if (nextChar(1) === '>') {
          tokens.push({
            type: TokenTypes.Operation,
            value: char + '>',
            line: tokenLine,
            column: tokenColumn,
          });
          advance(2);
        } else if (nextChar(1) === '-') {
          tokens.push({
            type: TokenTypes.Operation,
            value: char + '-',
            line: tokenLine,
            column: tokenColumn,
          });
          advance(2);
        } else if (nextChar(1) === '=') {
          tokens.push({
            type: TokenTypes.Operation,
            value: char + '=',
            line: tokenLine,
            column: tokenColumn,
          });
          advance(2);
        } else {
          tokens.push({
            type: TokenTypes.Operation,
            value: char,
            line: tokenLine,
            column: tokenColumn,
          });
          advance(1);
        }
      } else if (char === '*') {
        if (nextChar(1) === '*') {
          if (nextChar(2) === '=') {
            tokens.push({
              type: TokenTypes.Operation,
              value: '**=',
              line: tokenLine,
              column: tokenColumn,
            });
            advance(3);
          } else {
            tokens.push({
              type: TokenTypes.Operation,
              value: '**',
              line: tokenLine,
              column: tokenColumn,
            });
            advance(2);
          }
        } else if (nextChar(1) === '=') {
          tokens.push({
            type: TokenTypes.Operation,
            value: '*=',
            line: tokenLine,
            column: tokenColumn,
          });
          advance(2);
        } else {
          tokens.push({
            type: TokenTypes.Operation,
            value: '*',
            line: tokenLine,
            column: tokenColumn,
          });
          advance(1);
        }
      } else if (char === '/') {
        if (nextChar(1) === '/') {
          let commentValue = '';
          advance(2);
          while (position < code.length && nextChar() !== '\n') {
            commentValue += nextChar();
            advance();
          }
          advance(1);
        } else if (nextChar(1) === '*') {
          let commentValue = '';
          advance(2);
          while (position < code.length) {
            if (nextChar() === '*' && nextChar(1) === '/') {
              advance(2);
              break;
            }
            commentValue += nextChar();
            advance();
          }
        } else if (nextChar(1) === '=') {
          tokens.push({
            type: TokenTypes.Operation,
            value: '/=',
            line: tokenLine,
            column: tokenColumn,
          });
          advance(2);
        } else {
          tokens.push({
            type: TokenTypes.Operation,
            value: '/',
            line: tokenLine,
            column: tokenColumn,
          });
          advance(1);
        }
      } else if (char === '<' || char === '>') {
        if (nextChar(1) === '=') {
          tokens.push({
            type: TokenTypes.Operation,
            value: char + '=',
            line: tokenLine,
            column: tokenColumn,
          });
          advance(2);
        } else {
          tokens.push({
            type: TokenTypes.Operation,
            value: char,
            line: tokenLine,
            column: tokenColumn,
          });
          advance(1);
        }
      } else {
        tokens.push({
          type: TokenTypes.Operation,
          value: char,
          line: tokenLine,
          column: tokenColumn,
        });
        advance();
      }
    } else if (char === '=' || char === '!') {
      if (nextChar(1) === '=') {
        if (nextChar(2) === '=') {
          tokens.push({
            type: TokenTypes.Operation,
            value: char + '==',
            line: tokenLine,
            column: tokenColumn,
          });
          advance(3);
        } else {
          tokens.push({
            type: TokenTypes.Operation,
            value: char + '=',
            line: tokenLine,
            column: tokenColumn,
          });
          advance(2);
        }
      } else {
        tokens.push({
          type: TokenTypes.Operation,
          value: char,
          line: tokenLine,
          column: tokenColumn,
        });
        advance();
      }
    } else if (symbols.includes(char)) {
      if (char === '&' && nextChar(1) === '&') {
        tokens.push({
          type: TokenTypes.Symbol,
          value: char + '&',
          line: tokenLine,
          column: tokenColumn,
        });
        advance(2);
      } else if (char === '|' && nextChar(1) === '|') {
        tokens.push({
          type: TokenTypes.Symbol,
          value: char + '|',
          line: tokenLine,
          column: tokenColumn,
        });
        advance(2);
      } else {
        tokens.push({
          type: TokenTypes.Symbol,
          value: char,
          line: tokenLine,
          column: tokenColumn,
        });
        advance();
      }
    } else if (char === '"' || char === "'") {
      const quoteType = char;
      let stringValue = '';
      advance();

      while (
        position < code.length &&
        nextChar() !== quoteType &&
        nextChar() !== '\n'
      ) {
        stringValue += nextChar();
        advance();
      }

      if (nextChar() !== quoteType) {
        throw new SyntaxError(`Unterminated string literal`);
      }

      advance();

      tokens.push({
        type: TokenTypes.String,
        value: stringValue,
        line: tokenLine,
        column: tokenColumn,
      });
    } else {
      LexerError(
        filename,
        `Unexpected token '${char}'`,
        tokenLine,
        tokenColumn - 1,
        code.split(/\r?\n/)
      );
    }
  }
  return tokens;
}
