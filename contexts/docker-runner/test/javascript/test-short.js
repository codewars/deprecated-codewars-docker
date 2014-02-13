startTime = Date.now();
function someFunction(n) {
  return "result from function: " + n;
}

// expect
someFunction(10);
console.log((Date.now()-startTime));
