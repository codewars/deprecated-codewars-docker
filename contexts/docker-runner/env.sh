#!/bin/sh
export HOME=/home/noderunner
. ~/.nvm/nvm.sh || echo 'Error sourcing NVM in bootstrap' >2
nvm use v0.10.22 > /dev/null 2>&1

node /opt/docker-runner/server.js
