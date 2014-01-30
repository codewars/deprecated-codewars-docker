#!/bin/sh

# This will make things easy
export HOME=/opt/docker-runner

function errout() {
   { echo "$1" 1>&2; exit 1; }
}

. /home/noderunner/.nvm/nvm.sh || errout 'Error sourcing NVM in bootstrap'
nvm use v0.10.22 > /dev/null 2>&1

node ~/server.js
