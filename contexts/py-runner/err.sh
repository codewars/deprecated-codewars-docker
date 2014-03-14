#!/bin/bash

ERROR_HACK="$@"
EMPTY=''
if [ "${ERROR_HACK}" != "$EMPTY" ]; then
    echo -e "${ERROR_HACK}" 1>&2
fi
