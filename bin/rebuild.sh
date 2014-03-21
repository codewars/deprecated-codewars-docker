#!/bin/bash

CUR=`pwd`
if [[ $CUR != *contexts* ]]; then
    echo "Must not be called directly!! (yet)"
    echo "Please use context specific build script"
    exit 1
fi

# Change to source
NAME="$1"
IMAGE_NAME="codewars:$NAME"
IMAGE=$(docker images "codewars" | awk '{if ($2 == "runner") { print $3 }}')

CLEAN=false
TIDY=false
ONLY=false
SOFT=false
for arg; do
    if [ "$arg" == "--clean" ]; then 
        CLEAN=true;
    elif [ "$arg" == "-rm" ]; then
        TIDY=true
    elif [ "$arg" == "only" ]; then
        ONLY=true
    elif [ "$arg" == "soft" ]; then
        SOFT=true
    fi
done

if [ $CLEAN = false ] && [ $TIDY = true ]; then
    echo "HINT: -rm without clean can lead to conflicts"
fi

SAFE=$IMAGE_NAME
if [ "$1" == "runner" ]; then
    SAFE=$NAME
fi

if [ $CLEAN = true ]; then
    if [ SOFT = true ]; then 
        docker ps -a | grep "$SAFE" | awk '{print $1}' | xargs docker stop
        docker ps -a | grep "$SAFE" | awk '{print $1}' | xargs docker rm
    else 
        docker ps -a | grep "$SAFE" | awk '{print $1}' | xargs docker kill
        docker ps -a | grep "$SAFE" | awk '{print $1}' | xargs docker rm
    fi

    if [ $ONLY = true ]; then
        exit 0
    fi
fi

BUILD_DIR=../../build
if [ -d "$BUILD_DIR" ]; then
    rm -rf ../../build
fi
mkdir "$BUILD_DIR"
cp -r * "$BUILD_DIR"
cp ../common/* "$BUILD_DIR"
cd "$BUILD_DIR"

docker build -t "$IMAGE_NAME" -rm . ; SUCCESS=$?

if [ "$SUCCESS" -eq 0 ] && [ "$IMAGE" != "" ]; then
    docker rmi "$IMAGE"
fi

cd "$CUR"
rm -rf "$BUILD_DIR"
