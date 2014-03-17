#!/bin/sh

EOT_CH="␄"
RUNNER=${RUNNER:-python}
TIMEOUT=${TIMEOUT:-3}

V_PYTHON="$1"
PYTHON_SHIM="$2"

export HOME=/opt/apps/pyrunner

# Allow close means actual EOF will be interpreted
# as an end-of-script. This will allow StdinOnce: true
# to be sufficient. May come in handy for certain katas.
ALLOW_CLOSE=false
SCRIPT=''

# TODO exit with a codewars internal error code
errout () {
    { echo "$1" 1>&2; exit 1; }
}

doRunner () {
    if [ "$RUNNER" = "python" ]; then
        echo "$1" | timeout $TIMEOUT $V_PYTHON $PYTHON_SHIM
    fi
}

KATA_OUT=''
while read INPUT; do
    if [ "$INPUT" = "$EOT_CH" ]
    then
        KATA_OUT=$({ 
        doRunner "${SCRIPT}"  2>&1 1>&3 | xargs -0 /usr/local/bin/errorhack 
        } 3>&1 )
        echo -e "$KATA_OUT"
        KATA_OUT=''
        SCRIPT=''
    else
        SCRIPT="${SCRIPT}${INPUT}"
    fi
done

EMPTY=''
if [ "$ALLOW_CLOSE" = true ] && [ "$SCRIPT" != "$EMPTY" ]; then
    doRunner "$SCRIPT"
fi
