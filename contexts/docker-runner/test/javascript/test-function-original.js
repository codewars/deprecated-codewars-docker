startTime = Date.now();
function someFunction(n) {
  return 2*n;
}

// expect
if(someFunction(10) === 20) 
   console.log((Date.now()-startTime));
else throw new Error('Kata failed');
