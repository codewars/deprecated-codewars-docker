#!/bin/bash

cd /opt/docker-runner
. /home/noderunner/.nvm/nvm.sh && { nvm use v0.10.22; npm install; }
