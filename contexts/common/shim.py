#/usr/bin/python
from subprocess import Popen, PIPE
import os 
import sys
import json

if "RUNNER" in os.environ:
    language = os.environ["RUNNER"]
else:
    raise Exception("Runner not specified")

script = ''

bound = ['timeout', '3']

ARG = 1
STDIN = 2

commands = {
        'javascript' : { 'command': ['node'], 'method': STDIN },
        'coffeescript': { 'command': ['coffee', '-e'], 'method': ARG },
        'python' : { 'command': ['/opt/ve/pyrunner/bin/python'], 'method': STDIN }
        }

if not language in commands:
    raise Exception("Runner does not exist")


while True:
    iLine = raw_input()
    if iLine == '\xe2\x90\x84':
        conf = commands[language]
        if conf['method'] is STDIN:
            job = Popen(bound+conf['command'], stdin=PIPE, stdout=PIPE, stderr=PIPE)
            job.stdin.write(script)
            job.stdin.close()
            rett = job.wait()
            out = job.stdout.read()
            err = job.stderr.read()
        elif conf['method'] is ARG:
            job = Popen(bound+conf['command']+[script], stdout=PIPE, stderr=PIPE)
            rett = job.wait()
            out = job.stdout.read()
            err = job.stderr.read()

        print json.dumps({'stdout': out, 'stderr': err, "exitCode": rett})
        sys.stdout.flush()
        out = None
        err = None
        script = ''
    else:
        script = script + '\n' + iLine
