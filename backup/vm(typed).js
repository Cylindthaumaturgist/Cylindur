import * as fs from 'fs';

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
    ].includes(op);
  }

  let offset = 0;
  function decompileConstants(buf) {
    if (buf.readUInt32BE(offset) !== 0xc7114d3f)
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
        case 0xe1: {
          const number = buf.readDoubleBE(offset);
          offset += 8;
          constants.push(number);
          break;
        }
        case 0xe2: {
          const strLen = buf.readUInt32BE(offset);
          offset += 4;

          const strValue = buf.toString('utf8', offset, offset + strLen);
          offset += strLen;

          constants.push(strValue);
          break;
        }
        case 0xe3: {
          const bool = buf.readUInt8(offset++) === 1;
          constants.push(bool);
          break;
        }
        case 0xe6: {
          constants.push(null);
          break;
        }
        default:
          throw new Error('Invalid constant type!');
      }
    }

    return constants;
  }

  const STACK_BYTES = 64 * 1024; // 64 KB
  const NUMBER_SLOTS = STACK_BYTES / 8;
  const stackTypes = new Array(NUMBER_SLOTS);
  const arrayBuf = new ArrayBuffer(STACK_BYTES);
  const memory = {
    number: new Float64Array(arrayBuf),
    string: new Array(NUMBER_SLOTS),
    boolean: new Uint8Array(STACK_BYTES),
    function: new Array(NUMBER_SLOTS),
    null: new Array(NUMBER_SLOTS),
  };
  let sp = 0;
  
  function push(value) {
    const pointer = sp++;
    if (value === null) {
      memory.null[pointer] = null;
      stackTypes[pointer] = null;
      return;
    }
    
    const type = value?.type ?? typeof value;
    
    if (!(type in memory)) {
      throw new Error("Unsupported type: " + JSON.stringify(value, null, 2));
    }
    if (type === "boolean") {
      memory.boolean[pointer] = value ? 1 : 0;
    } else if (type === "number") {
      memory.number[pointer] = value;
    } else {
      memory[type][pointer] = value;
    }
    stackTypes[pointer] = type;
  }
  
  function pop() {
    if (sp <= 0) throw new Error("Stack Underflow!");
    const pointer = --sp;
    const type = stackTypes[pointer];
    let val;
  
    if (type === "boolean") {
      val = memory.boolean[pointer] !== 0;
    } else if (type === "number") {
      val = memory.number[pointer];
    } else {
      val = memory[type][pointer];
      memory[type][pointer] = undefined;
    }
  
    stackTypes[pointer] = undefined;
    return val;
  }
  
  function peekSecondToLast() {
    if (sp < 2) return null;
    const pointer = sp - 2;
    const type = stackTypes[pointer];
    return memory[type][pointer];
  }
  
  const globals = [];
  const callStack = [];
  let halted = false;

  const constants = decompileConstants(buffer);
  const mainLength = buffer.readUInt32BE(offset);
  offset += 4;
  
  // Optimize bytecode by removing unnecessary LOAD_VAR at loop end
  const mainBytecode = [];
  const rawBytecode = Array.from(buffer.slice(offset, offset + mainLength));
  let i = 0;
  while (i < rawBytecode.length) {
    const op = rawBytecode[i];
    mainBytecode.push(op);
    i++;
    
    if (opcodeHasArg(op)) {
      // Copy the 4-byte argument
      for (let j = 0; j < 4; j++) {
        mainBytecode.push(rawBytecode[i++]);
      }
    }
    
    // Optimization: Remove redundant LOAD_VAR after STORE_VAR in loops
    if (op === 0x0f && i < rawBytecode.length - 5) { // STORE_VAR
      const nextOp = rawBytecode[i];
      if (nextOp === 0x10) { // LOAD_VAR
        const storeArg = (mainBytecode[mainBytecode.length - 4] << 24) |
                         (mainBytecode[mainBytecode.length - 3] << 16) |
                         (mainBytecode[mainBytecode.length - 2] << 8) |
                         mainBytecode[mainBytecode.length - 1];
        
        const loadArg = (rawBytecode[i + 1] << 24) |
                        (rawBytecode[i + 2] << 16) |
                        (rawBytecode[i + 3] << 8) |
                        rawBytecode[i + 4];
        
        // If loading the same var that was just stored, skip it
        if (storeArg === loadArg) {
          i += 5; // Skip the LOAD_VAR and its argument
        }
      }
    }
  }
  
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

  let context = createContext(mainBytecode, globals, globals);

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
          push(constants[arg]);
          break;
        }
        case 0x02: {
          const b = pop();
          const a = pop();
          push(a + b);
          break;
        }
        case 0x03: {
          const b = pop();
          const a = pop();
          push(a - b);
          break;
        }
        case 0x04: {
          const b = pop();
          const a = pop();
          push(a * b);
          break;
        }
        case 0x05: {
          const b = pop();
          const a = pop();
          push(a / b);
          break;
        }
        case 0x06: {
          const b = pop();
          const a = pop();
          push(a > b);
          break;
        }
        case 0x07: {
          const b = pop();
          const a = pop();
          push(a < b);
          break;
        }
        case 0x08: {
          const b = pop();
          const a = pop();
          push(a >= b);
          break;
        }
        case 0x09: {
          const b = pop();
          const a = pop();
          push(a <= b);
          break;
        }
        case 0x0a: {
          const b = pop();
          const a = pop();
          push(a == b);
          break;
        }
        case 0x0b: {
          const b = pop();
          const a = pop();
          push(a != b);
          break;
        }
        case 0x0c: {
          const b = pop();
          const a = pop();
          push(a === b);
          break;
        }
        case 0x0d: {
          const b = pop();
          const a = pop();
          push(a !== b);
          break;
        }
        case 0x0e: {
          const b = pop();
          const a = pop();
          push(String(a) + String(b));
          break;
        }
        case 0x0f: {
          const arg = context.nextArg();
          const val = pop();
          globals[arg] = val;
          break;
        }
        case 0x10: {
          const arg = context.nextArg();
          const val = globals[arg];
          push(val);
          break;
        }
        case 0x11: {
          const arg = context.nextArg();
          const values = [];
          for (let i = 0; i < arg; i++) values.unshift(pop());
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
          for (let i = 0; i < argCount; i++) args.unshift(pop());

          const func = pop();
          if (func?.type !== 'function') throw new Error('Not a function');

          const newContext = createContext(func.body, args, func.globals);

          callStack.push(context);
          context = newContext;
          break;
        }
        case 0x14: {
          const returnValue = pop();
          if (callStack.length > 0) {
            context = callStack.pop();
            if (returnValue !== undefined) push(returnValue);
          } else {
            context.pc = context.bytecode.length;
            if (returnValue !== undefined) push(returnValue);
          }
          break;
        }
        case 0x16: {
          const arg = context.nextArg();
          push(context.locals[arg]);
          break;
        }
        case 0x17: {
          const arg = context.nextArg();
          context.pc = arg;
          break;
        }
        case 0x18: {
          const canJump = pop();
          if (!canJump) {
            const arg = context.nextArg();
            context.pc = arg;
          }
          break;
        }
        case 0x19: {
          const b = pop();
          const a = pop();
          push(a % b);
          break;
        }
        case 0x1a: {
          const b = pop();
          const a = pop();
          push(String(b) + String(a));
          break;
        }
        case 0x31: {
          const type = context.nextByte();
          const message = peekSecondToLast();
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
          }

          push(input);
          break;
        }
        case 0x32: {
          push(Date.now());
          break;
        }
        case 0xfe: {
          push(null);
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

	LOAD_NULL: 0xFE,
  HALT: 0xFF,
};

VM(file);
