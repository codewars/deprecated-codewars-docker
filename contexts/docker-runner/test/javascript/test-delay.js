startTime = Date.now();
function someFunction(n) {
  console.log((Date.now()-startTime));
  return "result from function: " + n;
}

// expect
setTimeout(function(){someFunction(10);}, 2000);
