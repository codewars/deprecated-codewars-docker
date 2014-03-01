#!/bin/sh

RUNNER=${RUNNER:-javascript}
TIMEOUT=${TIMEOUT:-3}

while :
do
      INPUTSCRIPT=`cat`

      #echo "TEST ERROR" 1>&2

      export HOME=/home/noderunner

      function errout() {
         { echo "$1" 1>&2; exit 1; }
      }

      . ~/.nvm/nvm.sh || errout 'Error sourcing NVM in bootstrap'
      nvm use v0.10.22 > /dev/null 2>&1

      # untested changes, revert and re-implement, git pull
      if [ "$RUNNER" == "javascript" ]; then 
         timeout $TIMEOUT node -e "${INPUTSCRIPT}"
      elif [ "$RUNNER" == "coffeescript" ]; then
         timeout $TIMEOUT coffee -e "${INPUTSCRIPT}"
      else
         errout 'Runner not specified... aborting'
      fi
done
