include#<SystemLogging>;

fun calculator(x: Number, y: Number, op: String) -> Void {
  var result: Number = 0;

  if (op === "+") {
    result = x + y;
  } else {
    System.ErrHalt("Invalid operation!");
		System.Colors.Red;
  }
  
  System.Log("{x} {op} {y} = {result}");
}

calculator(10, 10, "+");