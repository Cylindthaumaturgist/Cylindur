import * as fs from 'fs';
import { ReconstructToPrintFunction } from '../helpers/ReconstructToPrintFunction.js';

const file = fs.readFileSync('../compiler/code.cylinder');

function prompt(question) {
  fs.writeSync(1, question);
  const buffer = Buffer.alloc(1024);
  const bytes = fs.readSync(0, buffer, 0, 1024, null);
  return buffer.toString('utf8', 0, bytes).trim();
}

function VM(buffer) {
  function opcodeHasArg(op) {
    return [
      0x01, // LOAD_CONST
      0x0f, // STORE_VAR
      0x10, // LOAD_VAR
      0x11, // PRINT
      0x12, // DEF_FUNC
      0x13, // CALL
      0x15, // LOAD_GLOBAL
      0x16, // LOAD_PARAM
      0x17, // JMP
      0x18, // JMP_IF_FALSE
			0x1c, // STORE_PARAM
    ].includes(op);
  }

  let offset = 0;

  if (buffer.readUInt32BE(offset) !== 0xc7114d3f)
    throw new Error('Invalid Magic!');
  offset += 4;

  const version = buffer.readUInt8(offset++);
  if (version !== 0x01) throw new Error('Unsupported version');

  function decompileConstants(buf) {
    const constCount = buf.readUInt32BE(offset);
    offset += 4;

    const constants = new Array(256 * 16); // 4096 slots (32.77KB)
    let cp = 0; // constants pointer
    for (let i = 0; i < constCount; i++) {
      const constantType = buf.readUInt8(offset++);

      switch (constantType) {
        case 0xe1: {
          const number = buf.readDoubleBE(offset);
          offset += 8;
          constants[cp++] = number;
          break;
        }
        case 0xe2: {
          const strLen = buf.readUInt32BE(offset);
          offset += 4;

          const strValue = buf.toString('utf8', offset, offset + strLen);
          offset += strLen;

          constants[cp++] = strValue;
          break;
        }
        case 0xe3: {
          const bool = buf.readUInt8(offset++) === 1;
          constants[cp++] = bool;
          break;
        }
        case 0xe6: {
          constants[cp++] = null;
          break;
        }
        default:
          throw new Error('Invalid constant type!');
      }
    }

    return constants;
  }

  const stack = [];
  const globals = [];
  const callStack = [];
  let halted = false;

  const constants = decompileConstants(buffer);
  const mainLength = buffer.readUInt32BE(offset);
  offset += 4;
  const mainBytecode = buffer.slice(offset, offset + mainLength);
  offset += mainLength;

  function createContext(bytecode, locals, globals) {
    return {
      bytecode,
      pc: 0,
      locals,
      globals,
      nextByte() {
        const byte = this.bytecode[this.pc];
        this.pc++;
        return byte;
      },
      nextArg() {
        let arg = 0;
        for (let i = 0; i < 4; i++) {
          arg = (arg << 8) | this.nextByte();
        }
        return arg;
      },
    };
  }

  let context = createContext(Array.from(mainBytecode), globals, globals);
  //console.log(constants)
	
	const dispatch = new Array(255);
	dispatch[0x01] = ctx => stack.push(constants[ctx.nextArg()]);
	dispatch[0x02] = () => stack.push((a => a[1] + a[0])([stack.pop(), stack.pop()]));
	dispatch[0x03] = () => stack.push((a => a[1] - a[0])([stack.pop(), stack.pop()]));
	dispatch[0x04] = () => stack.push((a => a[1] * a[0])([stack.pop(), stack.pop()]));
	dispatch[0x05] = () => stack.push((a => a[1] / a[0])([stack.pop(), stack.pop()]));
	dispatch[0x06] = () => stack.push((a => a[1] > a[0])([stack.pop(), stack.pop()]));
	dispatch[0x07] = () => stack.push((a => a[1] < a[0])([stack.pop(), stack.pop()]));
	dispatch[0x08] = () => stack.push((a => a[1] >= a[0])([stack.pop(), stack.pop()]));
	dispatch[0x09] = () => stack.push((a => a[1] <= a[0])([stack.pop(), stack.pop()]));
	dispatch[0x0a] = () => stack.push((a => a[1] == a[0])([stack.pop(), stack.pop()]));
	dispatch[0x0b] = () => stack.push((a => a[1] != a[0])([stack.pop(), stack.pop()]));
	dispatch[0x0c] = () => stack.push((a => a[1] === a[0])([stack.pop(), stack.pop()]));
	dispatch[0x0d] = () => stack.push((a => a[1] !== a[0])([stack.pop(), stack.pop()]));
	dispatch[0x0e] = () => stack.push((a => String(a[1]) + String(a[0]))([stack.pop(), stack.pop()]));
	dispatch[0x0f] = ctx => ctx.locals[ctx.nextArg()] = stack.pop();
	dispatch[0x10] = ctx => stack.push(ctx.locals[ctx.nextArg()]);
	dispatch[0x11] = ctx => {
		const arg = ctx.nextArg();
    const values = [];
    for (let i = 0; i < arg; i++) values.unshift(stack.pop());
		const func = values.find(val => val?.type === "function");
		if (func) values[values.indexOf(func)] = ReconstructToPrintFunction(func);
		console.log(...values);
	};
	dispatch[0x12] = ctx => {
		const idx = ctx.nextArg();
          const paramCount = ctx.nextArg();
          const body = [];
          let depth = 0;

          while (ctx.pc < ctx.bytecode.length) {
            const opcode = ctx.nextByte();
            body.push(opcode);

            if (opcodeHasArg(opcode)) {
              const arg = ctx.nextArg();
              body.push((arg >> 24) & 0xff);
              body.push((arg >> 16) & 0xff);
              body.push((arg >> 8) & 0xff);
              body.push(arg & 0xff);
            }

            if (opcode === 0x12) depth++;
            else if (opcode === 0x14) {
              if (depth === 0) break;
              depth--;
            }
          }

          ctx.locals[idx] = {
            type: 'function',
            paramCount,
            body,
            globals: ctx.globals,
          };
	};
	dispatch[0x13] = ctx => {
		const argCount = ctx.nextArg();
          const args = [];
          for (let i = 0; i < argCount; i++) args.unshift(stack.pop());

          const func = stack.pop();
          if (func?.type !== 'function') throw new Error('Not a function');

          const newContext = createContext(func.body, [], func.globals);
          for (let i = 0; i < func.paramCount; i++) {
            newContext.locals[i] = args[i];
          }

          callStack.push(ctx);
          ctx = newContext;
	};
	dispatch[0x14] = ctx => {
		const returnValue = stack.pop();
          if (callStack.length > 0) {
            ctx = callStack.pop();
            if (returnValue !== undefined) stack.push(returnValue);
          } else {
            ctx.pc = ctx.bytecode.length;
            if (returnValue !== undefined) stack.push(returnValue);
          }
	};
	dispatch[0x15] = ctx => stack.push(ctx.globals[ctx.nextArg()]);
	dispatch[0x16] = ctx => stack.push(ctx.locals[ctx.nextArg()]);
  dispatch[0x17] = ctx => ctx.pc = ctx.nextArg();
	dispatch[0x18] = ctx => {
		 if (!stack.pop()) ctx.pc = ctx.nextArg();
	};
	dispatch[0x19] = () => stack.push((a => a[1] % a[0])([stack.pop(), stack.pop()]));
	dispatch[0x1a] = () => stack.push((a => String(a[0]) + String(a[1]))([stack.pop(), stack.pop()]));
	dispatch[0x1b] = () => stack.push(!stack.pop());
	dispatch[0x1c] = ctx => ctx.locals[ctx.nextArg()] = stack.pop();
	dispatch[0x31] = ctx => {
		const type = ctx.nextByte();
          const message =
            stack.length > 1 ? stack.splice(stack.length - 2, 1)[0] : null;
          let input = prompt(message ?? null);

          switch (type) {
            case 0xe1:
              if (/[a-zA-Z]+/.test(input))
                throw new Error('Expected type Number, but got: String');
              input = parseFloat(input);
              if (Number.isNaN(input)) input = null;
              break;

            case 0xe2:
              if (/\d+/.test(input))
                throw new Error('Expected type String, but got: Number');
              input = String(input);
              break;

            case 0xe3:
              input = input.toLowerCase();
              input = input === 'true' || input === '1' || input === 'yes';
              break;

            case 0xe7:
              break;
          }

          stack.push(input);
	}
	dispatch[0x32] = () => stack.push(Date.now());
	dispatch[0xfe] = () => stack.push(null);
	dispatch[0xff] = () => halted = true;
	
  function run(buf) {
    while (context && !halted) {
      if (context.pc >= context.bytecode.length) {
        if (callStack.length === 0) break;
        context = callStack.pop();
        continue;
      }

      const op = context.bytecode[context.pc++];
      if (dispatch[op]) dispatch[op](context);
    }
  }

  run(buffer);
	console.log(stack)
}

const opMap = {
  LOAD_CONST: 0x01,
  ADD: 0x02,
  SUB: 0x03,
  MUL: 0x04,
  DIV: 0x05,
  GT: 0x06,
  LT: 0x07,
  GT_OE: 0x08,
  LT_OE: 0x09,
  IS_EQUAL: 0x0a,
  IS_INEQUAL: 0x0b,
  STRICT_EQUAL: 0x0c,
  STRICT_INEQUAL: 0x0d,
  CONCAT: 0x0e,
  STORE_VAR: 0x0f,
  LOAD_VAR: 0x10,
  PRINT: 0x11,
  DEF_FUNC: 0x12,
  CALL: 0x13,
  RETURN: 0x14,
  LOAD_GLOBAL: 0x15,
  LOAD_PARAM: 0x16,
  JMP: 0x17,
  JMP_IF_FALSE: 0x18,
  MODULUS: 0x19,
  CONCAT_REV: 0x1a,
  NOT: 0x1b,
	STORE_PARAM: 0x1c,

  // SPECIAL CASES
  PROMPT: 0x31,
  TIME_NOW: 0x32,

  // TYPES
  number: 0xe1,
  string: 0xe2,
  boolean: 0xe3,
  array: 0xe4,
  object: 0xe5,
  null: 0xe6,

  LOAD_NULL: 0xfe,
  HALT: 0xff,
};

VM(file);
