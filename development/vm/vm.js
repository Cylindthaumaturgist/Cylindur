import * as fs from 'fs';
import { ReconstructToPrintFunction } from '../helpers/ReconstructToPrintFunction.js';

const file = fs.readFileSync('../compiler/code.cylinder');

function prompt(question) {
  fs.writeSync(1, question);
  const buffer = Buffer.alloc(1024);
  const bytes = fs.readSync(0, buffer, 0, 1024, null);
  return buffer.toString('utf8', 0, bytes).trim();
}

function sleep(ms) {
	return new Promise(res => setTimeout(res, ms));
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

  if (buffer.readUInt32BE(offset) !== 0x2E63796C)
    throw new Error('Invalid Magic!');
  offset += 4;

  const version = buffer.readUInt8(offset++);
  if (version !== 0x01) throw new Error('Unsupported version');

  function decompileConstants(buf) {
    const constCount = buf.readUInt32BE(offset);
    offset += 4;

    const constants = new Array(256 * 16); 
    let cp = 0; 
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
				case 0xe4: {
					const array = [];
					const length = buf.readUInt32BE(offset);
          offset += 4;
					
					for (let i = 0; i < length; i++) {
						const type = buf.readUInt8(offset++);
						if (type === 0xe1) {
							const number = buf.readDoubleBE(offset);
              offset += 8;
              array.push(number);
						} else if (type === 0xe2) {
							const strLen = buf.readUInt32BE(offset);
              offset += 4;
    
              const strValue = buf.toString('utf8', offset, offset + strLen);
              offset += strLen;
							array.push(strValue);
						} else if (type === 0xe3) {
							const bool = buf.readUInt8(offset++) === 1;
							array.push(bool);
						} else if (type === 0xe6) {
							array.push(null);
						}
					}
					constants[cp++] = [ ...array ];
					break;
				}
        case 0xe6: {
          constants[cp++] = null;
          break;
        }
        default:
          throw new Error('Invalid constant type! ' + "0x" + constantType.toString(16));
      }
    }

    return constants;
  }

  const memAlloc = 256;
  const stack = new Array(memAlloc);
  let sp = 0;
	
  const globals = [];
  const callStack = [];
  let halted = false;
	const templateRegex = /%\{0x([0-9A-Fa-f]{8})\}/;

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
				let arg = (bytecode[this.pc++] << 24) |
          (bytecode[this.pc++] << 16) |
          (bytecode[this.pc++] << 8) |
          bytecode[this.pc++];
        return arg;
      },
    };
  }

  let context = createContext(Array.from(mainBytecode), globals, globals);
  
  async function run(buf) {
    while (context && !halted) {
      if (context.pc >= context.bytecode.length) {
        if (callStack.length === 0) break;
        context = callStack.pop();
        continue;
      }

      const op = context.bytecode[context.pc++];
      
      switch (op) {
        case 0x01: {
          const arg = context.nextArg();
          stack[sp++] = constants[arg];
          break;
        }
        case 0x02: {
          const b = stack[--sp];
          const a = stack[--sp];
          stack[sp++] = a + b;
          break;
        }
        case 0x03: {
          const b = stack[--sp];
          const a = stack[--sp];
          stack[sp++] = a - b;
          break;
        }
        case 0x04: {
          const b = stack[--sp];
          const a = stack[--sp];
          stack[sp++] = a * b;
          break;
        }
        case 0x05: {
          const b = stack[--sp];
          const a = stack[--sp];
          stack[sp++] = a / b;
          break;
        }
        case 0x06: {
          const b = stack[--sp];
          const a = stack[--sp];
          stack[sp++] = a > b;
          break;
        }
        case 0x07: {
          const b = stack[--sp];
          const a = stack[--sp];
          stack[sp++] = a < b;
          break;
        }
        case 0x08: {
          const b = stack[--sp];
          const a = stack[--sp];
          stack[sp++] = a >= b;
          break;
        }
        case 0x09: {
          const b = stack[--sp];
          const a = stack[--sp];
          stack[sp++] = a <= b;
          break;
        }
        case 0x0a: {
          const b = stack[--sp];
          const a = stack[--sp];
          stack[sp++] = a == b;
          break;
        }
        case 0x0b: {
          const b = stack[--sp];
          const a = stack[--sp];
          stack[sp++] = a != b;
          break;
        }
        case 0x0c: {
          const b = stack[--sp];
          const a = stack[--sp];
          stack[sp++] = a === b;
          break;
        }
        case 0x0d: {
          const b = stack[--sp];
          const a = stack[--sp];
          stack[sp++] = a !== b;
          break;
        }
        case 0x0e: {
          const b = stack[--sp];
          const a = stack[--sp];
          stack[sp++] = String(a) + String(b);
          break;
        }
        case 0x0f: {
          const arg = context.nextArg();
          context.locals[arg] = stack[--sp]; 
          //console.log(context.locals, arg)
					break;
        }
        case 0x10: {
          const arg = context.nextArg();
          stack[sp++] = context.locals[arg];
          break;
        }
        case 0x11: {
					const arg = context.nextArg();
          const values = new Array(arg);
          for (let i = arg - 1; i >= 0; i--) {
            values[i] = stack[--sp];
          }
					for (let i = 0; i < arg; i++) {
            if (values[i]?.type === "function") {
              values[i] = ReconstructToPrintFunction(values[i]);
              break;
            }
          }
					
          values[0] = values[0].replace(templateRegex, (_, hex) => {
            const index = parseInt(hex, 16); 
            return (context.locals[index] || context.globals[index]) ?? hex;
          });
					
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
          for (let i = 0; i < argCount; i++) args.unshift(stack[--sp]);

          const func = stack[--sp];
          if (func?.type !== 'function') throw new Error('Not a function');

          const newContext = createContext(func.body, [], func.globals);
          for (let i = 0; i < func.paramCount; i++) {
            newContext.locals[i] = args[i];
          }

          callStack.push(context);
          context = newContext;
          break;
        }
        case 0x14: {
          const returnValue = stack[--sp];
          if (callStack.length > 0) {
            context = callStack.pop();
            if (returnValue !== undefined) stack[sp++] = returnValue;
          } else {
            context.pc = context.bytecode.length;
            if (returnValue !== undefined) stack[sp++] = returnValue;
          }
          break;
        }
				case 0x15: {
          const arg = context.nextArg();
          stack[sp++] = context.globals[arg];
          break;
        }
        case 0x16: {
          const arg = context.nextArg();
          stack[sp++] = context.locals[arg];
          break;
        }
        case 0x17: {
          const arg = context.nextArg();
          context.pc = arg;
          //console.log("0x17\nBytecodes:", context.bytecode, "pc:", context.pc, "current:", context.bytecode[context.pc])
          break;
        }
        case 0x18: {
          const canJump = stack[--sp];
          const arg = context.nextArg();
          if (!canJump) {
            context.pc = arg;
          }

          break;
        }
        case 0x19: {
          const b = stack[--sp];
          const a = stack[--sp];
          stack[sp++] = a % b;
          break;
        }
        case 0x1a: {
          const b = stack[--sp];
          const a = stack[--sp];
          stack[sp++] = String(b) + String(a);
          break;
        }
        case 0x1b: {
          stack[sp++] = !stack[--sp];
          break;
        }
				case 0x1c: {
					const arg = context.nextArg();
          context.locals[arg] = stack[--sp];
					break;
				}
				case 0x1d: {
					const type = context.nextByte();
					const arg = context.nextArg();
					const array = stack[--sp];
					if (type === 0xe1) stack[sp++] = array[arg];
					else if (type === 0xe8) stack[sp++] = array[context.locals[arg]];
					break;
				}
        case 0x41: {
          const type = context.nextByte();
          const message = stack[sp - 2];
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

          stack[sp++] = input;
          break;
        }
        case 0x42: {
          stack[sp++] = Date.now();
          break;
        }
				case 0x43: {
					stack[sp++] = Date();
					break;
				}
				case 0x44: {
					await sleep(stack[--sp]);
					break;
				}
        case 0xfe: {
          stack[sp++] = null;
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
    NOT: 0x1b,
		STORE_PARAM: 0x1c,
		ARRAY_VAL_POINTER: 0x1d,
    // AND
    // OR
    // XOR
    // POW
    // TYPE_CHECK

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
    any: 0xe7,

    LOAD_NULL: 0xfe,
    HALT: 0xff,
  };

VM(file);
