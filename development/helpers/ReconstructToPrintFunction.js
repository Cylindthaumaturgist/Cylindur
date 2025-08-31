const reversed = {
  0x01: "LOAD_CONST",
  0x02: "ADD",
  0x03: "SUB",
  0x04: "MUL",
  0x05: "DIV",
  0x06: "GT",
  0x07: "LT",
  0x08: "GT_OE",
  0x09: "LT_OE",
  0x0a: "IS_EQUAL",
  0x0b: "IS_INEQUAL",
  0x0c: "STRICT_EQUAL",
  0x0d: "STRICT_INEQUAL",
  0x0e: "CONCAT",
  0x0f: "STORE_VAR",
  0x10: "LOAD_VAR",
  0x11: "PRINT",
  0x12: "DEF_FUNC",
  0x13: "CALL",
  0x14: "RETURN",
  0x15: "LOAD_GLOBAL",
  0x16: "LOAD_PARAM",
  0x17: "JMP",
  0x18: "JMP_IF_FALSE",
  0x19: "MODULUS",
  0x1a: "CONCAT_REV",
  0x1b: "NOT",
  0x1c: "STORE_PARAM",
  0x31: "PROMPT",
  0x32: "TIME_NOW",
  0xe1: "number",
  0xe2: "string",
  0xe3: "boolean",
  0xe4: "array",
  0xe5: "object",
  0xe6: "null",
  0xe7: "any",
  0xfe: "LOAD_NULL",
  0xff: "HALT"
};
	
function ReconstructToPrintFunction(func) {
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
	
	let params = "";
  for (let i = 0; i < func.paramCount; i++) {
    params += "\x1b[38;2;156;220;254mvar" + i + "\x1b[0m" + (i === func.paramCount - 1 ? "" : ", ");
  }
	const log = [
		"\x1b[38;2;86;156;214mfun\x1b[0m \x1b[38;2;78;201;176mUnknown\x1b[0m(" + params + "\x1b[0m) {",
		"\x20\x20\x1b[0m[\x1b[38;2;106;153;85mbytecodes\x1b[0m]",
		"}"
	];
	
	/*const body = func.body;
	let hadReturned = false;
	let pc = 0;
	while (!hadReturned && pc < body.length) {
		const byte = body[pc++];
		let arg = [];
		if (opcodeHasArg(byte)) {
			for (let i = 0; i < 4; i++) {
				arg.push(body[pc++]);
			}
		}
		const byteName = reversed[byte];
		
		switch (byteName) {
			case "LOAD_CONST": {
				
			}
		}
	}*/
	
	return (log.join("\n"));
}

export { ReconstructToPrintFunction };