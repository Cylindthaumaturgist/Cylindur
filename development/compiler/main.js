import { Lexer } from './lexer.js';
import { Parser } from './parser.js';
import { Compiler } from './compiler.js';
import * as fs from 'fs';

const filename = 'code.cyl';

const code = fs.readFileSync(`../${filename}`, 'utf-8');
const Lexed = Lexer(code, filename);
const parsed = Parser(Lexed, code, filename);

//console.dir(parsed, {depth: null})

const cylinder = filename.split('.')[0] + '.cylinder';
const compiled = Compiler(parsed);

console.log(
  Buffer.from(compiled)
    .toString('hex')
    .match(/.{1,2}/g)
    .join(' ')
);
fs.writeFileSync(cylinder, compiled);
