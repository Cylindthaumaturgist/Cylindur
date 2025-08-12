export default class CaretError extends Error {
  constructor(type, file, message, line, column, sourceLines) {
    const RESET = '\x1b[0m';
    const RED = '\x1b[38;2;244;71;71m';
    const IDENTIFIERS = '\x1b[38;2;156;220;254m';
    const KEYWORDS = '\x1b[38;2;86;156;214m';
    const STRINGS = '\x1b[38;2;206;145;120m';
    const NUMBERS = '\x1b[38;2;220;220;170m';
    const FUNC_NAME = '\x1b[38;2;220;220;170m';
    const COMMENTS = '\x1b[38;2;106;153;85m';
    const OPERATORS = '\x1b[38;2;212;212;212m';
    const CLASSES = '\x1b[38;2;78;201;176m';
    const BOLD = '\x1b[1m';
    const GRAY = '\x1b[37m';
    const H_START = '\u0000';
    const H_END = '\u0001';
    const keywords = new Set([
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
    ]);
    const tokenRE =
      /\/\/.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(\.\d+)?\b|[A-Za-z_][A-Za-z0-9_]*|\s+|./g;
    const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

    let errorMsg = `${RED}${type}${RESET}: (${BOLD}${file}${RESET}) ${message} (${line}:${column})\n\n`;
    const startLine = Math.max(1, line - 3);
    const endLine = Math.min(sourceLines.length, line + 3);

    for (let i = startLine; i <= endLine; i++) {
      const isErrorLine = i === line;
      const prefix = isErrorLine ? `${RED}>${RESET}` : ' ';
      const lineNumber = i.toString().padStart(3);
      const rawLine = (sourceLines[i - 1] ?? '').replace(/\t/g, '  ');

      let tokens = [];
      let m;
      tokenRE.lastIndex = 0;
      while ((m = tokenRE.exec(rawLine)) !== null) {
        const t = m[0];
        let type = 'other';
        if (t.startsWith('//')) type = 'comment';
        else if (t[0] === '"' || t[0] === "'") type = 'string';
        else if (/^\s+$/.test(t)) type = 'space';
        else if (/^\d/.test(t)) type = 'number';
        else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) type = 'ident';
        tokens.push({ text: t, start: m.index, end: m.index + t.length, type });
        if (type === 'comment') break;
      }

      for (let j = 0; j < tokens.length; j++) {
        const tok = tokens[j];
        if (tok.type === 'ident') {
          if (j > 0 && tokens[j - 1].text === '.') {
            let m = j + 1;
            while (m < tokens.length && tokens[m].type === 'space') m++;
						
            if (m < tokens.length && tokens[m].text === '(') {
              tok.type = 'func';
            } else if (/^[A-Z]/.test(tok.text)) {
              tok.type = 'class';
            } else {
              tok.type = 'ident';
            }
            continue;
          }

          let k = j + 1;
          while (k < tokens.length && tokens[k].type === 'space') k++;
          if (k < tokens.length && tokens[k].text === '.') {
            if (/^[A-Z]/.test(tok.text)) {
            tok.type = 'class';
          } else {
						tok.type = 'ident';
					}
            continue;
          }

          if (keywords.has(tok.text)) {
            tok.type = 'keyword';
          } else if (/^(true|false|null)$/.test(tok.text)) {
            tok.type = 'literal';
          } else {
            let m = j + 1;
            while (m < tokens.length && tokens[m].type === 'space') m++;
            if (m < tokens.length && tokens[m].text === '(') {
              tok.type = 'func';
            } else {
              tok.type = 'ident';
            }
          }
					if (/^[A-Z]/.test(tok.text)) {
            tok.type = 'class';
          }
        }
      }

      if (isErrorLine) {
        const idx = column - 1;
        let located = false;
        for (const t of tokens) {
          if (idx >= t.start && idx < t.end) {
            const rel = idx - t.start;
            const before = t.text.slice(0, rel);
            const ch = t.text[rel] ?? '';
            const after = t.text.slice(rel + 1);
            t.text = before + H_START + ch + H_END + after;
            located = true;
            break;
          }
        }
        if (!located) {
          if (tokens.length) {
            const last = tokens[tokens.length - 1];
            if (last.type === 'space') last.text = last.text + H_START + H_END;
            else
              tokens.push({
                text: H_START + H_END,
                start: rawLine.length,
                end: rawLine.length,
                type: 'marker',
              });
          } else {
            tokens.push({
              text: H_START + H_END,
              start: 0,
              end: 0,
              type: 'marker',
            });
          }
        }
      }

      const colorFor = (type) => {
        if (type === 'keyword') return KEYWORDS;
        if (type === 'string') return STRINGS;
        if (type === 'func') return FUNC_NAME;
        if (type === 'number') return NUMBERS;
        if (type === 'ident') return IDENTIFIERS;
        if (type === 'literal') return KEYWORDS;
        if (type === 'comment') return COMMENTS;
        if (type === 'class') return CLASSES;
        return '';
      };

      let coloredLine = '';
      for (const tok of tokens) {
        if (tok.type === 'space') {
          coloredLine += tok.text;
          continue;
        }
        if (tok.type === 'comment') {
          coloredLine += tok.text.startsWith(GREY)
            ? tok.text
            : `${COMMENTS}${tok.text}${RESET}`;
          continue;
        }
        const color = colorFor(tok.type);
        let s = tok.text;
        let out = '';
        let pos = 0;
        while (true) {
          const hs = s.indexOf(H_START, pos);
          if (hs === -1) {
            const part = s.slice(pos);
            out += color ? color + part + RESET : part;
            break;
          }
          const part = s.slice(pos, hs);
          out += color ? color + part + RESET : part;
          const he = s.indexOf(H_END, hs + 1);
          if (he === -1) {
            const rest = s.slice(hs);
            out += color ? color + rest + RESET : rest;
            break;
          }
          const ch = s.slice(hs + 1, he);
          out += `${RED}${BOLD}${ch}${RESET}`;
          pos = he + 1;
        }
        coloredLine += out;
      }

      const linePrefix = `${prefix}${prefix.length === 0 ? '' : ' '}${GRAY}${lineNumber}${RESET} |  `;
      errorMsg += `${linePrefix}${coloredLine}\n`;

      if (isErrorLine) {
        const visiblePad = stripAnsi(linePrefix).length;
        const caretPos = visiblePad + (column - 1);
        errorMsg += ' '.repeat(Math.max(0, caretPos)) + `${RED}^${RESET}\n`;
      }
    }

    super();
    this.name = type;
    this.message = errorMsg;
    this.stack = '';
    this.toString = () => this.message;
  }
}
