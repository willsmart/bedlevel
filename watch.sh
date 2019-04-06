#!/bin/bash

args="$@"
export args

watchfile="$HOME/bedlevel.in"

function go {
    echo "Running with $args"
    node main.js $args
}

modwas=`stat -f '%m' "$watchfile" 2> /dev/null`

while true ; do
    mod=`stat -f '%m' "$watchfile" 2> /dev/null`
    if [[ "$mod" == "$modwas" ]]; then
        sleep 1
        continue
    fi

    modwas="$mod"
    sleep 1
    go
done
