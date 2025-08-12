export default class CaretError extends Error {
  constructor(type, file, message, line, column, sourceLines) {
    const RESET = '\x1b[38;2;244;71;71m';
    const BLUE = '\x1b[94m';
    const MAGENTA = '\x1b[38;5;171m';
    const LIGHTBLUE = '\x1b[96m';
    const GREEN = '\x1b[32m';
    const YELLOW = '\x1b[33m';
    const GREY = '\x1b[90m';
    const RED = '\x1b[31m';
    const BOLD = '\x1b[1m';
    const LIGHTRED = '\x1b[91m';
		const REDDISH_BROWN = '\x1b[38;2;205;133;63m';
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
    const tokenRE = /\/\/.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(\.\d+)?\b|[A-Za-z_][A-Za-z0-9_]*|\s+|./g;
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
          if (keywords.has(tok.text)) tok.type = 'keyword';
          else if (/^(true|false|null)$/.test(tok.text)) tok.type = 'literal';
          else {
            let k = j + 1;
            while (k < tokens.length && tokens[k].type === 'space') k++;
            if (k < tokens.length && tokens[k].text === '(') tok.type = 'func';
            else if (/^[A-Z]/.test(tok.text)) tok.type = 'Class';
            else tok.type = 'ident';
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
            else tokens.push({ text: H_START + H_END, start: rawLine.length, end: rawLine.length, type: 'marker' });
          } else {
            tokens.push({ text: H_START + H_END, start: 0, end: 0, type: 'marker' });
          }
        }
      }

      const colorFor = (type) => {
        if (type === 'keyword') return BLUE;
        if (type === 'string') return REDDISH_BROWN;
        if (type === 'func') return CYAN;
        if (type === 'number') return YELLOW;
        if (type === 'ident') return MAGENTA;
        if (type === 'literal') return LIGHTBLUE;
        if (type === 'comment') return GREY;
        return '';
      };

      let coloredLine = '';
      for (const tok of tokens) {
        if (tok.type === 'space') {
          coloredLine += tok.text;
          continue;
        }
        if (tok.type === 'comment') {
          coloredLine += tok.text.startsWith(GREY) ? tok.text : `${GREY}${tok.text}${RESET}`;
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
          out += `${LIGHTRED}${BOLD}${ch}${RESET}`;
          pos = he + 1;
        }
        coloredLine += out;
      }

      const linePrefix = `${prefix}${prefix.length === 0 ? '' : ' '}${GREY}${lineNumber}${RESET} |  `;
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

