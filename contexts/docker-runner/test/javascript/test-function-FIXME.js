startTime = Date.now();
function someFunction(n) {
  console.log('inside function was: ' + n);
}
someFunction('testing');
␄
// FIXME everything below comments will be commented out
// due to lack of newline preservation
//if(someFunction(10) === 20) 
//   console.log((Date.now()-startTime));
//else throw new Error('Kata failed');
