function sFact(num) {
    var rval=1;
    for (var i = 2; i <= num; i++)
        rval = rval * i;
    return rval;
}

// TODO finish test
//return sFact(2000); // is this actually calulated?
return sFact(140);
