var express = require('express'),
    streams = require('stream'),
    streamBuffers = require('stream-buffers'),
    fs = require('fs'),
    config = require('./config');


(function(options) {

    var host = options.host || 'localhost';
    port = options.port;
    if(!port) {
        port = process.env.CODE_RUNNER_PORT || process.argv.indexOf('-p') > 0 ? 
            process.argv[process.argv.indexOf('-p')+1] : null; 
    }
    var baseDir = options.baseDir || '';

    var CodeRunner = require('./codewars-runner')(config);

    var runners = {};

    for(var rc in options.runners) {
        var runConfig = options.runners[rc];
        runners[runConfig.language] = CodeRunner.createRunner(runConfig);
    }


    function getError(errString) {
        return {
            statusCode: 500,
            stdout: null,
            stderr: errString
        };
    }

    // response format.  Filter errors here.
    // TODO timeout error
    function result(finished, startTime) {
        var responseTime = !!startTime ? Date.now()-startTime : null;
        var timeout = (finished.statusCode == 124);
        return {
            statusCode: finished.statusCode,
            timeout: timeout,
            stdout: finished.stdout,
            stderr: finished.stderr,
            solutionTime: finished.duration, // TODO change order of operation
            responseTime: responseTime
        }
    }

    this.createStreamForScript = function(language, script) {
        var readStrBuffer = new streamBuffers.ReadableStreamBuffer();
        readStrBuffer.put(script, 'utf8');
        codeStream = new streams.Readable().wrap(readStrBuffer);
        codeStream.on('error', function(err) {
            console.log('INPUT had an error: '+err);
        });
        return codeStream;
    }

    var app = express();
    app.use(express.static(__dirname + '/public'))
        .use(express.favicon())
        .use(express.bodyParser());

    app.get('/:runner/test', function(req, res) {
        var startTime = Date.now();
        var resultCallback = function() { res.send(result(job, startTime)); }
        var job = runners[req.params.runner].createJob(resultCallback);
        job.test();
    });

    app.post('/:runner/run', function(req, res) {
        var startTime = Date.now();
        var cStream = createStreamForScript(req.params.runner, req.body.code);
        if(!!cStream) {
            var resultCallback = function() { res.send(result(job, startTime)); }
            var job = runners[req.params.runner].createJob(resultCallback);
            job.run(cStream);
        } else res.send(getError('Problem streaming from POST'));
    });
    app.listen(this.port);
})(config);
