#!/bin/bash

# working sort of
#ERR=$((
#node wait.js | xargs ./hack.sh
#) 2>&1)

# works completely
OUTPUT=$((
( echo test; echo err 1>&2 ) 2>&1 1>&3 | xargs ./err.sh
) 3>&1)

echo -e "Output was
$OUTPUT"
