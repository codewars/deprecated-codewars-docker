#!/bin/sh

RUNNER=${RUNNER:-javascript}

INPUTSCRIPT=`cat`

echo "TEST ERROR" 1>&2

export HOME=/home/noderunner

function errout() {
   { echo "$1" 1>&2; exit 1; }
}

. ~/.nvm/nvm.sh || errout 'Error sourcing NVM in bootstrap'
nvm use v0.10.22 > /dev/null 2>&1

if [ "$RUNNER" == "javascript" ]; then 
   node -e "${INPUTSCRIPT}"
elif [ "$RUNNER" == "coffeescript" ]; then
   coffee -e "${INPUTSCRIPT}"
else
   errout 'Runner not specified... aborting'
fi
