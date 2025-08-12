include*<SystemLogging>;

func calculator(x: Number, y: Number, op: String) -> Void {
  var result: Float | Number = 0;

  if (op === "+") {
    result = x + y;
  } else if (op === "-") {
    result = x - y;
  } else if (op === "*") {
    result = x * y;
  } else if (op === "/") {
    if (y === 0) {
      System.ErrHalt("Second number must be more than 0!");
    }
    result = x / y;
  } else {
    System.ErrHalt("Invalid operation!");
  }
  
  System.LogTemplate("{x} {op} {y} = {result}");
}

calculator(10, 10, "+");
var test: String = "10" + 10;