import * as fs from 'fs';

const file = fs.readFileSync('../compiler/code.cylinder');

function VM(buffer) {
  const includedBM = new Map();

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
    ].includes(op);
  }

  let offset = 0;
  function decompileConstants(buf) {
    if (buf.readUInt32BE(offset) !== 0xbeefc0de)
      throw new Error('Invalid Magic!');
    offset += 4;

    const version = buf.readUInt8(offset++);
    if (version !== 0x01) throw new Error('Unsupported version');

    const constCount = buf.readUInt32BE(offset);
    offset += 4;

    const constants = [];
    for (let i = 0; i < constCount; i++) {
      const constantType = buf.readUInt8(offset++);

      switch (constantType) {
        case 0xe0: {
          const number = buf.readDoubleBE(offset);
          offset += 8;
          constants.push(number);
          break;
        }
        case 0xe1: {
          const strLen = buf.readUInt32BE(offset);
          offset += 4;

          const strValue = buf.toString('utf8', offset, offset + strLen);
          offset += strLen;

          constants.push(strValue);
          break;
        }
        case 0xe2: {
          const bool = buf.readUInt8(offset++) === 1;
          constants.push(bool);
          break;
        }
        case 0xe5: {
          constants.push(null);
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
	const mainBytecode = buffer.slice(offset, offset + mainLength)
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
      }
    };
	}
	
	let context = createContext(Array.from(mainBytecode), globals, globals);
  //console.log(constants)

  function run(buf) {
    while (context && !halted) {
      if (context.pc >= context.bytecode.length) {
        if (callStack.length === 0) break;
        context = callStack.pop();
        continue;
      }

      const op = context.nextByte();

      switch (op) {
        case 0x01: {
          const arg = context.nextArg();
          stack.push(constants[arg]);
          break;
        }
        case 0x02: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(a + b);
          break;
        }
        case 0x03: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(a - b);
          break;
        }
        case 0x04: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(a * b);
          break;
        }
        case 0x05: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(a / b);
          break;
        }
        case 0x06: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(a > b);
          break;
        }
        case 0x07: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(a < b);
          break;
        }
        case 0x08: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(a >= b);
          break;
        }
        case 0x09: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(a <= b);
          break;
        }
        case 0x0a: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(a == b);
          break;
        }
        case 0x0b: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(a != b);
          break;
        }
        case 0x0c: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(a === b);
          break;
        }
        case 0x0d: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(a !== b);
          break;
        }
        case 0x0e: {
          const b = stack.pop();
          const a = stack.pop();
          stack.push(String(a) + String(b));
          break;
        }
        case 0x0f: {
          const arg = context.nextArg();

          globals[arg] = stack.pop();
          break;
        }
        case 0x10: {
          const arg = context.nextArg();
          stack.push(globals[arg]);
          break;
        }
        case 0x11: {
          const arg = context.nextArg();

          const values = [];
          for (let i = 0; i < arg; i++) values.unshift(stack.pop());
          console.log(...values);
          break;
        }
        case 0x12: {
          const idx = context.nextArg();
          const paramCount = context.nextArg();
          const body = [];
          let depth = 0;

          while (context.pc < context.bytecode.length) {
            const opcode = context.nextByte();
            body.push(opcode);

            if (opcodeHasArg(opcode)) {
              const arg = context.nextArg();
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

          context.locals[idx] = {
            type: 'function',
            paramCount,
            body,
            globals: context.globals,
          };
          break;
        }
        case 0x13: {
          const argCount = context.nextArg();
          const args = [];
          for (let i = 0; i < argCount; i++) 
            args.unshift(stack.pop());
          
          const func = stack.pop();
          if (func?.type !== 'function') 
            throw new Error('Not a function');

          const newContext = createContext(
            func.body,
            args,  // parameters become locals
            func.globals
          );

          callStack.push(context);
          context = newContext;
          break;
        }
        case 0x14: {
          const returnValue = stack.pop();
          if (callStack.length > 0) {
            context = callStack.pop();
            if (returnValue !== undefined) 
              stack.push(returnValue);
          } else {
            context.pc = context.bytecode.length; // end execution
            if (returnValue !== undefined) 
              stack.push(returnValue);
          }
          break;
        }
				case 0x16: {
					const arg = context.nextArg();
          stack.push(context.locals[arg]);
					break;
				}
        case 0xff: {
          halted = true;

          break;
        }
      }
    }
  }

  run(buffer);
}

const reference = {
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
  number: 0xe0,
  string: 0xe1,
  boolean: 0xe2,
  array: 0xe3,
  object: 0xe4,
  null: 0xe5,
  HALT: 0xff,
};

VM(file);

/*class VM {
  constructor(buffer) {
    this.stack = [];
    this.globals = [];
    this.callStack = [];
    this.halted = false;
  }

  parseBinary(buf) {
    let offset = 0;

    if (buf.readUInt32BE(offset) !== 0xBEEFC0DE) throw new Error('Invalid magic');
    offset += 4;

    const version = buf.readUInt8(offset++);
    if (version !== 0x01) throw new Error('Unsupported version');

    const constCount = buf.readUInt8(offset++);
    const constants = [];
    for (let i = 0; i < constCount; i++) {
      constants.push(buf.readDoubleBE(offset));
      offset += 8;
    }

    const bcCount = buf.readUInt8(offset++);
    const bytecodes = [];
    for (let i = 0; i < bcCount; i++) {
      const op = buf.readUInt8(offset++);
      let arg = null;

      // Here we decide if opcode has args
      if (
        op === 0x01 || // LOAD_CONST
        op === 0x0F || // STORE_VAR
        op === 0x10 || // LOAD_VAR
        op === 0x12 || // DEF_FUNC
        op === 0x13 || // CALL
        op === 0x11 || // PRINT
        op === 0x15 || // LOAD_GLOBAL
        op === 0x16    // LOAD_PARAM
      ) {
        arg = buf.readUInt32BE(offset);
        offset += 4;
      }

      bytecodes.push({ op, arg });
    }

    return { constants, bytecodes };
  }

  run() {
    const opNames = {
      0x01: 'LOAD_CONST',
      0x02: 'ADD',
      0x03: 'SUB',
      0x04: 'MUL',
      0x05: 'DIV',
      0x06: 'GT',
      0x07: 'LT',
      0x08: 'GT_OE',
      0x09: 'LT_OE',
      0x0A: 'EQUAL',
      0x0B: 'INEQUAL',
      0x0C: 'STRICT_EQUAL',
      0x0D: 'STRICT_INEQUAL',
      0x0E: 'CONCAT',
      0x0F: 'STORE_VAR',
      0x10: 'LOAD_VAR',
      0x11: 'PRINT',
      0x12: 'DEF_FUNC',
      0x13: 'CALL',
      0x14: 'RETURN',
      0x15: 'LOAD_GLOBAL',
      0x16: 'LOAD_PARAM',
      0xFF: 'HALT'
    };

    let context = {
      bytecode: this.bytecode,
      pc: 0,
      locals: this.globals,
      globals: this.globals
    };

    while (context && !this.halted) {
      const bytecode = context.bytecode;
      if (context.pc >= bytecode.length) {
        if (this.callStack.length === 0) break;
        context = this.callStack.pop();
        continue;
      }

      const cmd = bytecode[context.pc++];
      const opName = opNames[cmd.op];

      switch (opName) {
        case 'LOAD_CONST':
          this.stack.push(this.constants[cmd.arg]);
          break;
        case 'ADD':
          this.stack.push(this.stack.pop() + this.stack.pop());
          break;
        case 'SUB': {
          const b = this.stack.pop(), a = this.stack.pop();
          this.stack.push(a - b);
          break;
        }
        case 'MUL':
          this.stack.push(this.stack.pop() * this.stack.pop());
          break;
        case 'DIV': {
          const b = this.stack.pop(), a = this.stack.pop();
          this.stack.push(a / b);
          break;
        }
        case 'GT': {
          const b = this.stack.pop(), a = this.stack.pop();
          this.stack.push(a > b);
          break;
        }
        case 'LT': {
          const b = this.stack.pop(), a = this.stack.pop();
          this.stack.push(a < b);
          break;
        }
        case 'GT_OE': {
          const b = this.stack.pop(), a = this.stack.pop();
          this.stack.push(a >= b);
          break;
        }
        case 'LT_OE': {
          const b = this.stack.pop(), a = this.stack.pop();
          this.stack.push(a <= b);
          break;
        }
        case 'EQUAL': {
          const b = this.stack.pop(), a = this.stack.pop();
          this.stack.push(a == b);
          break;
        }
        case 'INEQUAL': {
          const b = this.stack.pop(), a = this.stack.pop();
          this.stack.push(a != b);
          break;
        }
        case 'STRICT_EQUAL': {
          const b = this.stack.pop(), a = this.stack.pop();
          this.stack.push(a === b);
          break;
        }
        case 'STRICT_INEQUAL': {
          const b = this.stack.pop(), a = this.stack.pop();
          this.stack.push(a !== b);
          break;
        }
        case 'CONCAT': {
          const b = this.stack.pop(), a = this.stack.pop();
          this.stack.push(a + b);
          break;
        }
        case 'STORE_VAR':
          this.globals[cmd.arg] = this.stack.pop();
          break;
        case 'LOAD_VAR':
          this.stack.push(this.globals[cmd.arg]);
          break;
        case 'PRINT': {
          const count = cmd.arg;
          const values = [];
          for (let i = 0; i < count; i++) values.unshift(this.stack.pop());
          console.log(...values);
          break;
        }
        case 'DEF_FUNC': {
          const [name, paramCount] = [cmd.arg, 1]; // placeholder handling
          const body = [];

          let j = context.pc;
          let depth = 0;
          while (j < context.bytecode.length) {
            const next = context.bytecode[j];
            if (opNames[next.op] === 'DEF_FUNC') depth++;
            if (opNames[next.op] === 'RETURN' && depth === 0) {
              body.push(next);
              break;
            }
            if (opNames[next.op] === 'RETURN') depth--;
            body.push(next);
            j++;
          }

          const closureGlobals = context.globals;
          context.locals[name] = {
            type: 'function',
            paramCount,
            body,
            globals: closureGlobals
          };
          context.pc = j + 1;
          break;
        }
        case 'LOAD_PARAM':
          this.stack.push(context.locals[cmd.arg]);
          break;
        case 'CALL': {
          const args = [];
          for (let i = 0; i < cmd.arg; i++) args.unshift(this.stack.pop());
          const func = this.stack.pop();
          if (!func || func.type !== 'function') throw new Error('Not a function');
          const newContext = {
            bytecode: func.body,
            pc: 0,
            locals: args,
            globals: func.globals
          };
          this.callStack.push(context);
          context = newContext;
          break;
        }
        case 'RETURN': {
          let returnValue;
          if (this.stack.length > 0) returnValue = this.stack.pop();
          if (this.callStack.length > 0) {
            context = this.callStack.pop();
            this.stack.push(returnValue);
          } else {
            context.pc = bytecode.length;
          }
          break;
        }
        case 'LOAD_GLOBAL':
          this.stack.push(context.globals[cmd.arg]);
          break;
        case 'HALT':
          this.halted = true;
          break;
        default:
          throw new Error(`Unknown opcode: ${cmd.op}`);
      }
    }
  }
}

const a = new VM(Buffer.from(file));
a.run();*/
