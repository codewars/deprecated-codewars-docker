#!/bin/sh

RUNNER=${RUNNER:-python}

INPUTSCRIPT=`cat`
V_PYTHON=/opt/ve/pyrunner/bin

export HOME=/opt/apps/pyrunner

function errout() {
   { echo "$1" 1>&2; exit 1; }
}

echo "${INPUTSCRIPT}" | $1 $2
