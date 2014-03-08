#!/bin/sh
EOT_CH="␄"
# Allow close means actual EOF will be interpreted
# as an end-of-script. This will allow StdinOnce: true
# to be sufficient.
ALLOW_CLOSE=false

RUNNER=${RUNNER:-javascript}
TIMEOUT=${TIMEOUT:-3}

export HOME=/home/noderunner
. ~/.nvm/nvm.sh || errout 'Error sourcing NVM in bootstrap'
nvm use v0.10.22 > /dev/null 2>&1

SCRIPT=''

errout () {
    { echo "$1" 1>&2; exit 1; }
}

doRunner () {
    if [ "$RUNNER" = "javascript" ]; then
        timeout $TIMEOUT node -e "${SCRIPT}"
    elif [ "$RUNNER" = "coffeescript" ]; then
        timeout $TIMEOUT coffee -e "${SCRIPT}"
    else
        errout 'Runner not specified... aborting'
    fi
    echo "maybe"
}

while read INPUT; do
    if [ "$INPUT" = "$EOT_CH" ]
    then
        doRunner "$SCRIPT"
        SCRIPT=''
    else
        SCRIPT="${SCRIPT}${INPUT}"
    fi
done

EMPTY=''
if [ "$ALLOW_CLOSE" = true ] && [ "$SCRIPT" != "$EMPTY" ]; then
    doRunner "$SCRIPT"
fi
