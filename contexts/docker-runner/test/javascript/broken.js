function someBrokenFunction(n) {
  var badVar = ';
  console.log('I should not appear...');
  return n;
}

someBrokenFunction(10);
