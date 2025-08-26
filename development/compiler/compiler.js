import CaretError from './helpers/CaretError.js';

String.prototype.capitalize = function () {
  if (!this) return '';
  return this[0].toUpperCase() + this.slice(1);
};

function CompileError(file, message, line, column, sourceLines) {
  console.log(
    new CaretError(
      'CompileError',
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

/*
  const builtInFunctionsType = {
    System: {
      Log: {
        params: [{ name: 'args', type: 'Any', variadic: true }],
        returnType: 'Void',
      },
    },
  };

  try {
    TypeCheck(ast, builtInFunctionsType);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
*/

function Compiler(ast, fileName, code) {
  const builtInIncludes = new Set(['SystemLogging', 'Mathematics', 'Chrono']);
  const bytes = [];
  const constants = [];
  let variableIndex = 0;
  const globalScope = new Map();
  const constantVariableMap = new Map();
  const scopes = [globalScope];
  const includedBuiltIn = new Set();
  const ver = 0x01;

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

  function writeUint8(arr, byte) {
    arr.push(byte & 0xff);
  }

  function writeUint32(arr, num) {
    arr.push((num >> 24) & 0xff);
    arr.push((num >> 16) & 0xff);
    arr.push((num >> 8) & 0xff);
    arr.push(num & 0xff);
  }

  function writeDouble(arr, num) {
    const buf = Buffer.allocUnsafe(8);
    buf.writeDoubleBE(num);
    for (const b of buf) arr.push(b);
  }

  function writeString(arr, str) {
    const buf = Buffer.from(str, 'utf8');
    writeUint32(arr, buf.length);
    for (const b of buf) arr.push(b);
  }

  function getVarIndex(name) {
		console.log(scopes)
    for (let i = scopes.length - 1; i >= 0; i--) {
      if (scopes[i].has(name)) return scopes[i].get(name);
    }
    throw new Error(`Variable ${name} not declared`);
  }

  function declareVar(name) {
    const currentScope = scopes[scopes.length - 1];
		console.log("scope:",currentScope)
    if (!currentScope.has(name)) currentScope.set(name, variableIndex++);
    return currentScope.get(name);
  }

  function isInsideFunction(root, target) {
    let result = [false, 0];

    function walk(node, depth) {
      if (!node || typeof node !== 'object') return;

      if (node === target) {
        if (depth > 0) result = [true, 9 * depth];
        return;
      }

      let newDepth = depth;
      if (
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression'
      ) {
        newDepth++;
      }

      for (const key in node) {
        const child = node[key];
        if (Array.isArray(child)) {
          for (const c of child) walk(c, newDepth);
        } else if (child && typeof child === 'object') {
          walk(child, newDepth);
        }
        if (result[0]) return; // stop if found inside func
      }
    }

    walk(root, 0);
    return result;
  }

  const builtInHandlers = {
    System: {
      Log: {
        requiredLib: 'SystemLogging',
        compile: (expr, bytes, constants) => {
          expr.arguments.forEach((arg) => compileExpression(arg));
          if (expr.arguments.length > 0) {
            writeUint8(bytes, opMap.PRINT);
            writeUint32(bytes, expr.arguments.length);
          }
        },
      },
      LogHalt: {
        requiredLib: 'SystemLogging',
        compile: (expr, bytes, constants) => {
          expr.arguments.forEach((arg) => compileExpression(arg));
          if (expr.arguments.length > 0) {
            writeUint8(bytes, opMap.PRINT);
            writeUint32(bytes, expr.arguments.length);
            writeUint8(bytes, opMap.HALT);
          }
        },
      },
      Err: {
        requiredLib: 'SystemLogging',
        compile: (expr, bytes, constants) => {
          expr.arguments.forEach((arg) => compileExpression(arg));
          const ansi = '\x1b[1;38;2;244;71;71m[ERROR]:\x1b[22m ';
          const reset = '\x1b[0m';

          if (!constants.includes(ansi)) constants.push(ansi);
          if (!constants.includes(reset)) constants.push(reset);
          if (expr.arguments.length > 0) {
            writeUint8(bytes, opMap.LOAD_CONST);
            writeUint32(bytes, constants.indexOf(ansi));
            writeUint8(bytes, opMap.CONCAT_REV);

            writeUint8(bytes, opMap.LOAD_CONST);
            writeUint32(bytes, constants.indexOf(reset));
            writeUint8(bytes, opMap.CONCAT);

            writeUint8(bytes, opMap.PRINT);
            writeUint32(bytes, expr.arguments.length);
          }
        },
      },
      Err: {
        requiredLib: 'SystemLogging',
        compile: (expr, bytes, constants) => {
          expr.arguments.forEach((arg) => compileExpression(arg));
          const ansi = '\x1b[1;38;2;244;71;71m[ERROR]:\x1b[22m ';
          const reset = '\x1b[0m';

          if (!constants.includes(ansi)) constants.push(ansi);
          if (!constants.includes(reset)) constants.push(reset);
          if (expr.arguments.length > 0) {
            writeUint8(bytes, opMap.LOAD_CONST);
            writeUint32(bytes, constants.indexOf(ansi));
            writeUint8(bytes, opMap.CONCAT_REV);

            writeUint8(bytes, opMap.LOAD_CONST);
            writeUint32(bytes, constants.indexOf(reset));
            writeUint8(bytes, opMap.CONCAT);

            writeUint8(bytes, opMap.PRINT);
            writeUint32(bytes, expr.arguments.length);
            writeUint8(bytes, opMap.HALT);
          }
        },
      },
      Warn: {
        requiredLib: 'SystemLogging',
        compile: (expr, bytes, constants) => {
          expr.arguments.forEach((arg) => compileExpression(arg));
          const ansi = '\x1b[1;38;2;255;215;0m[WARN]:\x1b[22m ';
          const reset = '\x1b[0m';

          if (!constants.includes(ansi)) constants.push(ansi);
          if (!constants.includes(reset)) constants.push(reset);
          if (expr.arguments.length > 0) {
            writeUint8(bytes, opMap.LOAD_CONST);
            writeUint32(bytes, constants.indexOf(ansi));
            writeUint8(bytes, opMap.CONCAT_REV);

            writeUint8(bytes, opMap.LOAD_CONST);
            writeUint32(bytes, constants.indexOf(reset));
            writeUint8(bytes, opMap.CONCAT);

            writeUint8(bytes, opMap.PRINT);
            writeUint32(bytes, expr.arguments.length);
          }
        },
      },
      Warn: {
        requiredLib: 'SystemLogging',
        compile: (expr, bytes, constants) => {
          expr.arguments.forEach((arg) => compileExpression(arg));
          const ansi = '\x1b[1;38;2;255;215;0m[WARN]:\x1b[22m ';
          const reset = '\x1b[0m';

          if (!constants.includes(ansi)) constants.push(ansi);
          if (!constants.includes(reset)) constants.push(reset);
          if (expr.arguments.length > 0) {
            writeUint8(bytes, opMap.LOAD_CONST);
            writeUint32(bytes, constants.indexOf(ansi));
            writeUint8(bytes, opMap.CONCAT_REV);

            writeUint8(bytes, opMap.LOAD_CONST);
            writeUint32(bytes, constants.indexOf(reset));
            writeUint8(bytes, opMap.CONCAT);

            writeUint8(bytes, opMap.PRINT);
            writeUint32(bytes, expr.arguments.length);
            writeUint8(bytes, opMap.HALT);
          }
        },
      },
      Info: {
        requiredLib: 'SystemLogging',
        compile: (expr, bytes, constants) => {
          expr.arguments.forEach((arg) => compileExpression(arg));
          const ansi = '\x1b[1;37m[INFO]:\x1b[22m ';
          const reset = '\x1b[0m';

          if (!constants.includes(ansi)) constants.push(ansi);
          if (!constants.includes(reset)) constants.push(reset);
          if (expr.arguments.length > 0) {
            writeUint8(bytes, opMap.LOAD_CONST);
            writeUint32(bytes, constants.indexOf(ansi));
            writeUint8(bytes, opMap.CONCAT_REV);

            writeUint8(bytes, opMap.LOAD_CONST);
            writeUint32(bytes, constants.indexOf(reset));
            writeUint8(bytes, opMap.CONCAT);

            writeUint8(bytes, opMap.PRINT);
            writeUint32(bytes, expr.arguments.length);
          }
        },
      },
      Info: {
        requiredLib: 'SystemLogging',
        compile: (expr, bytes, constants) => {
          expr.arguments.forEach((arg) => compileExpression(arg));
          const ansi = '\x1b[1;37m[INFO]:\x1b[22m ';
          const reset = '\x1b[0m';

          if (!constants.includes(ansi)) constants.push(ansi);
          if (!constants.includes(reset)) constants.push(reset);
          if (expr.arguments.length > 0) {
            writeUint8(bytes, opMap.LOAD_CONST);
            writeUint32(bytes, constants.indexOf(ansi));
            writeUint8(bytes, opMap.CONCAT_REV);

            writeUint8(bytes, opMap.LOAD_CONST);
            writeUint32(bytes, constants.indexOf(reset));
            writeUint8(bytes, opMap.CONCAT);

            writeUint8(bytes, opMap.PRINT);
            writeUint32(bytes, expr.arguments.length);
            writeUint8(bytes, opMap.HALT);
          }
        },
      },
      Prompt: {
        requiredLib: 'SystemLogging',
        compile: (expr, bytes, constants) => {
          expr.arguments.forEach((arg) => compileExpression(arg));
          let type = opMap.string;
          switch (expr.arguments[1]?.value) {
            case 'Number':
              type = opMap.number;
              break;
            case 'String':
              type = opMap.string;
              break;
            case 'Boolean':
              type = opMap.boolean;
              break;
            case 'Any':
              type = opMap.any;
              break;
            default:
              type = opMap.any;
          }

          writeUint8(bytes, opMap.PROMPT);
          writeUint8(bytes, type);
        },
      },
    },
    Math: {
      PI: {
        requiredLib: 'Mathematics',
        type: 'variable',
        value: 3.141592653589793,
      },
      E: {
        requiredLib: 'Mathematics',
        type: 'variable',
        value: 2.718281828459045,
      },
      PI32: {
        requiredLib: 'Mathematics',
        type: 'variable',
        value: 3.1415926,
      },
      E32: {
        requiredLib: 'Mathematics',
        type: 'variable',
        value: 2.7182818,
      },
      Pow2: {
        requiredLib: 'Mathematics',
        compile: (expr, bytes, constants) => {
          const name = 'Math_Pow2';
          const currentScope = scopes[scopes.length - 1];

          if (!currentScope.has(name)) {
            declareVar(name);
            const idx = getVarIndex(name);

            const argc = 1;
            writeUint8(bytes, opMap.DEF_FUNC);
            writeUint32(bytes, idx);
            writeUint32(bytes, argc);

            writeUint8(bytes, opMap.LOAD_PARAM);
            writeUint32(bytes, 0);
            writeUint8(bytes, opMap.LOAD_PARAM);
            writeUint32(bytes, 0);
            writeUint8(bytes, opMap.MUL);
            writeUint8(bytes, opMap.RETURN);
          }

          // Load the function
          const idx = getVarIndex(name);
          writeUint8(bytes, opMap.LOAD_VAR);
          writeUint32(bytes, idx);

          // Compile the arguments
          expr.arguments.forEach((arg) => compileExpression(arg));

          // Call the function with the correct number of arguments
          writeUint8(bytes, opMap.CALL);
          writeUint32(bytes, expr.arguments.length);
        },
      },
    },
    Time: {
      Now: {
        requiredLib: 'Chrono',
        compile: (expr, bytes, constants) => {
          expr.arguments.forEach((arg) => compileExpression(arg));
          writeUint8(bytes, opMap.TIME_NOW);
        },
      },
    },
  };

  function isBuiltInMemberFunc(propertyName) {
    return [
      'Log',
      'Err',
      'Warn',
      'Info',
      'LogHalt',
      'ErrHalt',
      'WarnHalt',
      'InfoHalt',
      'Now',
      'Prompt',
    ].includes(propertyName);
  }

  const functionStack = [];

  ast.body.forEach((node) => {
    if (node.type === 'VariableDeclaration') {
      node.declarations.forEach((decl) => declareVar(decl.id.name));
    } else if (node.type === 'FunctionDeclaration') {
      declareVar(node.id.value);
    }
  });

  function compileExpression(node) {
    if (!node || !node.type)
      throw new Error('Invalid node: ' + JSON.stringify(node));

    switch (node.type) {
      case 'StringLiteral': {
        const val = String(node.value);
        if (!constants.includes(val)) constants.push(val);
        writeUint8(bytes, opMap.LOAD_CONST);
        writeUint32(bytes, constants.indexOf(val));
        break;
      }
      case 'BoolLiteral': {
        const val = node.value === 'true' || node.value === true;
        if (!constants.includes(val)) constants.push(val);
        writeUint8(bytes, opMap.LOAD_CONST);
        writeUint32(bytes, constants.indexOf(val));
        break;
      }
      case 'FloatLiteral':
      case 'NumberLiteral': {
        const val = Number(node.value);
        if (!constants.includes(val)) constants.push(val);
        writeUint8(bytes, opMap.LOAD_CONST);
        writeUint32(bytes, constants.indexOf(val));
        break;
      }
      case 'Identifier': {
        if (Object.keys(builtInHandlers).includes(node.value)) {
          const msg = `const ${node.value} = [native code];`;
          if (!constants.includes(msg)) constants.push(msg);

          writeUint8(bytes, opMap.LOAD_CONST);
          writeUint32(bytes, constants.indexOf(msg));
        } else {
          const funcContext = functionStack[functionStack.length - 1];
          if (funcContext?.params.has(node.value)) {
            writeUint8(bytes, opMap.LOAD_PARAM);
            writeUint32(bytes, funcContext.params.get(node.value));
          } else {
            const idx = getVarIndex(node.value);
            writeUint8(bytes, opMap.LOAD_VAR);
            writeUint32(bytes, idx);
          }
        }
        break;
      }
      case 'Null': {
        writeUint8(bytes, opMap.LOAD_NULL);
        break;
      }
      case 'CallExpression': {
        let funcIndex;

        if (node.callee.type === 'Identifier') {
          const name = node.callee.value;
          const funcContext = functionStack[functionStack.length - 1];
          const inParams = funcContext?.params.has(name);
          const inScope = scopes[scopes.length - 1].has(name);

          funcIndex = getVarIndex(name);
          writeUint8(
            bytes,
            inParams || inScope ? opMap.LOAD_VAR : opMap.LOAD_GLOBAL
          );
          writeUint32(bytes, funcIndex);
          node.arguments.forEach((arg) => compileExpression(arg));
          writeUint8(bytes, opMap.CALL);
          writeUint32(bytes, node.arguments.length);
        } else if (node.callee.type === 'MemberExpression') {
          const objectName = node.callee.object.value;
          const propName = node.callee.property.value;

          funcIndex = builtInHandlers[objectName]?.[propName];
          if (funcIndex === undefined)
            throw new Error(`Unknown function ${objectName}.${propName}`);
          funcIndex?.compile(node, bytes, constants);
        } else {
          throw new Error(`Unsupported callee type: ${node.callee.type}`);
        }

        break;
      }
      case 'BinaryExpression': {
        const isConcat =
          node.operator === '+' &&
          (node.left.type === 'StringLiteral' ||
            node.right.type === 'StringLiteral');

        compileExpression(node.left);
        compileExpression(node.right);

        if (isConcat) {
          writeUint8(bytes, opMap.CONCAT);
        } else {
          const opMapOps = {
            '+': 'ADD',
            '-': 'SUB',
            '*': 'MUL',
            '/': 'DIV',
            '>': 'GT',
            '<': 'LT',
            '>=': 'GT_OE',
            '<=': 'LT_OE',
            '==': 'IS_EQUAL',
            '!=': 'IS_INEQUAL',
            '===': 'STRICT_EQUAL',
            '!==': 'STRICT_INEQUAL',
            '%': 'MODULUS',
          };
          const op = opMapOps[node.operator];
          if (!op) throw new Error(`Unknown operator: ${node.operator}`);
          writeUint8(bytes, opMap[op]);
        }
        break;
      }

      case 'MemberExpression': {
        const objectName = node.object.value;
        const propertyName = node.property.value;
        const handler = builtInHandlers[objectName][propertyName];

        if (!handler)
          throw new Error(`Unknown member: ${objectName}.${propertyName}`);
        if (handler.type === 'variable') {
          if (!constants.includes(handler.value)) constants.push(handler.value);
          writeUint8(bytes, opMap.LOAD_CONST);
          writeUint32(bytes, constants.indexOf(handler.value));
        } else if (isBuiltInMemberFunc(propertyName)) {
          const msg = `fun ${propertyName.capitalize()}() {\n\x20\x20[native code];\n}`;
          if (!constants.includes(msg)) constants.push(msg);

          writeUint8(bytes, opMap.LOAD_CONST);
          writeUint32(bytes, constants.indexOf(msg));
        }
        break;
      }
      case 'UnaryExpression': {
        const { operator, argument, prefix } = node.value ?? node;
        
        if (argument.type !== 'Identifier') {
          throw new Error('UnaryExpression argument must be an identifier');
        }
				
				const funcContext = functionStack[functionStack.length - 1];
				let isParam = funcContext?.params.has(argument.value);
				let idx;
				
				if (isParam) {
					idx = funcContext?.params.get(argument.value);
				} else {
					idx = getVarIndex(argument.value);
				}

        if (
          (operator === '++' || operator === '--') &&
          !constants.includes(1)
        ) {
          constants.push(1);
        }
        const oneIdx = constants.indexOf(1);

        if (operator === '!') {
          writeUint8(bytes, isParam ? opMap.LOAD_PARAM : opMap.LOAD_VAR);
          writeUint32(bytes, idx);
          writeUint8(bytes, opMap.NOT);
        } else if (operator === '++' || operator === '--') {
          if (prefix) {
            // Prefix: compute new value, store, push result
            writeUint8(bytes, isParam ? opMap.LOAD_PARAM : opMap.LOAD_VAR);
            writeUint32(bytes, idx);
            writeUint8(bytes, opMap.LOAD_CONST);
            writeUint32(bytes, oneIdx);
            writeUint8(bytes, operator === '++' ? opMap.ADD : opMap.SUB);

            // Store updated value
            writeUint8(bytes, isParam ? opMap.STORE_PARAM : opMap.STORE_VAR);
            writeUint32(bytes, idx);

            // Push result for expression
            writeUint8(bytes, isParam ? opMap.LOAD_PARAM : opMap.LOAD_VAR);
            writeUint32(bytes, idx);
          } else {
            // Postfix: push old value first
            writeUint8(bytes, isParam ? opMap.LOAD_PARAM : opMap.LOAD_VAR);
            writeUint32(bytes, idx);

            // Compute new value
            writeUint8(bytes, isParam ? opMap.LOAD_PARAM : opMap.LOAD_VAR);
            writeUint32(bytes, idx);
            writeUint8(bytes, opMap.LOAD_CONST);
            writeUint32(bytes, oneIdx);
            writeUint8(bytes, operator === '++' ? opMap.ADD : opMap.SUB);

            // Store updated value
            writeUint8(bytes, isParam ? opMap.STORE_PARAM : opMap.STORE_VAR);
            writeUint32(bytes, idx);
          }
        } else {
          throw new Error(`Unsupported unary operator: ${operator}`);
        }

        break;
      }
      default:
        throw new Error(`Unsupported expression: ${JSON.stringify(node)}`);
    }
  }

  function compileNode(node) {
    switch (node.type) {
      case 'IncludeExpression': {
        if (node.isBuiltin) {
          if (!builtInIncludes.has(node.library))
            throw new Error('Unknown built-in library: ' + node.library);
          includedBuiltIn.add(node.library);
        }
        break;
      }
      case 'VariableDeclaration': {
        const isConst = node.kind === 'Constant';

        node.declarations.forEach((decl) => {
          compileExpression(decl.init);
          const idx = declareVar(decl.id.value);
          if (isConst) constantVariableMap.set(idx, true);
          writeUint8(bytes, opMap.STORE_VAR);
          writeUint32(bytes, idx);
        });
        break;
      }
      case 'FunctionDeclaration': {
        const idx = getVarIndex(node.id.value);
        const argc = node.params.length;
        writeUint8(bytes, opMap.DEF_FUNC);
        writeUint32(bytes, idx);
        writeUint32(bytes, argc);

        const localScope = new Map();
        scopes.push(localScope);
				
				let oldVarIndex = variableIndex;
				variableIndex = argc;

        const paramMap = new Map();
        node.params.forEach((param, i) => {
					paramMap.set(param.name, i);
			  });
        functionStack.push({ params: paramMap });

        let hasReturn = false;
        node.body.forEach((stmt) => {
          compileNode(stmt);
          if (stmt.type === 'ReturnStatement') hasReturn = true;
        });
        if (!hasReturn) writeUint8(bytes, opMap.RETURN);

        functionStack.pop();
        scopes.pop();
				
				variableIndex = oldVarIndex;
        break;
      }
      case 'ReturnStatement': {
        if (node.argument) compileExpression(node.argument);
        writeUint8(bytes, opMap.RETURN);
        break;
      }
      case 'AssignmentExpression': {
        if (node.left.type !== 'Identifier')
          throw new Error('Only simple assignments supported');
        const funcContext = functionStack[functionStack.length - 1];
				let isParam = funcContext?.params.has(node.left.value);
				let idx;
				
				if (isParam) {
					idx = funcContext?.params.get(node.left.value);
				} else {
					idx = getVarIndex(node.left.value);
				}
				
        if (constantVariableMap.get(idx))
          throw new Error(`Assignment to constant: ${node.left.value}`);

        if (['+=', '-=', '*=', '/='].includes(node.operator)) {
          writeUint8(bytes, isParam ? opMap.LOAD_PARAM : opMap.LOAD_VAR);
          writeUint32(bytes, idx);
          compileExpression(node.right);
          const opMapOps = {
            '+=': 'ADD',
            '-=': 'SUB',
            '*=': 'MUL',
            '/=': 'DIV',
          };
          writeUint8(bytes, opMap[opMapOps[node.operator]]);
          writeUint8(bytes, isParam ? opMap.STORE_PARAM : opMap.STORE_VAR);
          writeUint32(bytes, idx);
        } else if (node.operator === '=') {
          compileExpression(node.right);
          writeUint8(bytes, isParam ? opMap.STORE_PARAM : opMap.STORE_VAR);
          writeUint32(bytes, idx);
        } else {
          throw new Error(`Unsupported assignment operator: ${node.operator}`);
        }
        break;
      }
      case 'ExpressionStatement': {
        const expr = node.expression;

        if (expr.type === 'UnaryExpression') {
          const funcContext = functionStack[functionStack.length - 1];
          const isParam = funcContext?.params.has(expr.argument.value);
        
          let idx;
          if (isParam) {
            idx = funcContext.params.get(expr.argument.value);
          } else {
            idx = getVarIndex(expr.argument.value);
          }
        
          if (!constants.includes(1)) constants.push(1);
        
          // Postfix (++ / --)
          writeUint8(bytes, isParam ? opMap.LOAD_PARAM : opMap.LOAD_VAR);
          writeUint32(bytes, idx);
        
          writeUint8(bytes, isParam ? opMap.LOAD_PARAM : opMap.LOAD_VAR);
          writeUint32(bytes, idx);
          writeUint8(bytes, opMap.LOAD_CONST);
          writeUint32(bytes, constants.indexOf(1));
          writeUint8(bytes, expr.operator === '++' ? opMap.ADD : opMap.SUB);
        
          writeUint8(bytes, isParam ? opMap.STORE_PARAM : opMap.STORE_VAR);
          writeUint32(bytes, idx);
        
          break;
        }

        if (
          expr.type === 'CallExpression' &&
          expr.callee.type === 'MemberExpression'
        ) {
          const objectName = expr.callee.object.value;
          const propertyName = expr.callee.property.value;
          const handler = builtInHandlers[objectName]?.[propertyName];
          if (handler) {
            if (!includedBuiltIn.has(handler.requiredLib)) {
              throw new Error(
                `To use ${objectName}.${propertyName}(); You must include built in library: '${handler.requiredLib}'`
              );
            }
            handler.compile(expr, bytes, constants);
          }
        } else if (expr.type === 'CallExpression') {
          let funcIndex;
          if (expr.callee.type === 'Identifier') {
            const name = expr.callee.value;
            const funcContext = functionStack[functionStack.length - 1];
            const inParams = funcContext?.params.has(name);
            const inScope = scopes[scopes.length - 1].has(name);
            funcIndex = getVarIndex(name);
            writeUint8(
              bytes,
              inParams || inScope ? opMap.LOAD_VAR : opMap.LOAD_GLOBAL
            );
            writeUint32(bytes, funcIndex);
          }
          expr.arguments.forEach((arg) => compileExpression(arg));
          writeUint8(bytes, opMap.CALL);
          writeUint32(bytes, expr.arguments.length);
        }

        if (expr.type === 'MemberExpression') {
          const objectName = expr.object.value;
          const propertyName = expr.property.value;
          const handler = builtInHandlers[objectName]?.[propertyName];
          if (handler) {
            if (!includedBuiltIn.has(handler.requiredLib)) {
              throw new Error(
                `To use ${objectName}.${propertyName}, you must include built-in library: '${handler.requiredLib}'`
              );
            }
            if (!constants.includes(handler.value))
              constants.push(handler.value);
            writeUint8(bytes, opMap.LOAD_CONST);
            writeUint32(bytes, constants.indexOf(handler.value));
          }
        }

        break;
      }
      case 'IfStatement': {
        compileExpression(node.test);

        const jmpIfFalsePos = bytes.length;
        writeUint8(bytes, opMap.JMP_IF_FALSE);
        writeUint32(bytes, 0);

        if (node.consequent.type === 'BlockStatement') {
          node.consequent.body.forEach(compileNode);
        } else {
          compileNode(node.consequent);
        }

        const jmpPos = bytes.length;
        writeUint8(bytes, opMap.JMP);
        writeUint32(bytes, 0);

        const offset1 = bytes.length;
        bytes[jmpIfFalsePos + 1] = (offset1 >> 24) & 0xff;
        bytes[jmpIfFalsePos + 2] = (offset1 >> 16) & 0xff;
        bytes[jmpIfFalsePos + 3] = (offset1 >> 8) & 0xff;
        bytes[jmpIfFalsePos + 4] = offset1 & 0xff;

        if (node.alternate) {
          if (node.alternate.type === 'BlockStatement') {
            node.alternate.body.forEach(compileNode);
          } else {
            compileNode(node.alternate);
          }
        }

        const offset2 = bytes.length;
        bytes[jmpPos + 1] = (offset2 >> 24) & 0xff;
        bytes[jmpPos + 2] = (offset2 >> 16) & 0xff;
        bytes[jmpPos + 3] = (offset2 >> 8) & 0xff;
        bytes[jmpPos + 4] = offset2 & 0xff;
        break;
      }
      case 'WhileStatement': {
        const scope = scopes[scopes.length - 1];
        const loopStart = bytes.length;
        const isInsideFunc = isInsideFunction(ast, node);

        compileExpression(node.test);

        const jmpIfFalsePos = bytes.length;
        writeUint8(bytes, opMap.JMP_IF_FALSE);
        writeUint32(bytes, 0);

        if (node.body.type === 'BlockStatement') {
          node.body.body.forEach(compileNode);
        } else {
          compileNode(node.body);
        }
				console.log(isInsideFunc[1])

        writeUint8(bytes, opMap.JMP);
        writeUint32(
          bytes,
          isInsideFunc[0] ? loopStart - isInsideFunc[1] : loopStart
        );

        const offsetAfterBody = isInsideFunc[0]
          ? bytes.length - isInsideFunc[1]
          : bytes.length;

        bytes[jmpIfFalsePos + 1] = (offsetAfterBody >> 24) & 0xff;
        bytes[jmpIfFalsePos + 2] = (offsetAfterBody >> 16) & 0xff;
        bytes[jmpIfFalsePos + 3] = (offsetAfterBody >> 8) & 0xff;
        bytes[jmpIfFalsePos + 4] = offsetAfterBody & 0xff;

        break;
      }
      default:
        throw new Error(`Unsupported node type: ${node.type}`);
    }
  }

  ast.body.forEach(compileNode);

  writeUint8(bytes, opMap.HALT);

  const header = [0xc7, 0x11, 0x4d, 0x3f, ver];

  const constantsBytes = []; // [opMap.CONST_LEN];
  writeUint32(constantsBytes, constants.length);
  for (const c of constants) {
    if (typeof c === 'number') {
      writeUint8(constantsBytes, opMap.number);
      writeDouble(constantsBytes, c);
    } else if (typeof c === 'string') {
      writeUint8(constantsBytes, opMap.string);
      writeString(constantsBytes, c);
    } else if (typeof c === 'boolean') {
      writeUint8(constantsBytes, opMap.boolean);
      writeUint8(constantsBytes, c ? 1 : 0);
    } else if (c === null) {
      writeUint8(constantsBytes, opMap.null);
    } else {
      throw new Error('Unsupported constant type: ' + typeof c);
    }
  }

  const bytecodesLengthBytes = []; // [opMap.BYTE_LEN];
  writeUint32(bytecodesLengthBytes, bytes.length);

  return Buffer.from([
    ...header,
    ...constantsBytes,
    ...bytecodesLengthBytes,
    ...bytes,
  ]);
}

export { Compiler };
