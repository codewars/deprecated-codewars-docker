#!/bin/bash
docker kill controller && docker rm controller
docker rmi codewars:runner
docker build -t="codewars:runner" -rm .
docker run -i -d -p 80:2222 -name="controller" codewars:runner
