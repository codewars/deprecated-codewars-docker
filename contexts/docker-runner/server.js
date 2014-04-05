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
    var arrayOfRunners = [];

    for(var rc in options.runners) {
        var runConfig = options.runners[rc];
        var aRunner = CodeRunner.createRunner(runConfig);
        runners[runConfig.language] = aRunner;
        arrayOfRunners.push(aRunner);
    }


    function errResponse(error) {
        error = error || new Error();
        var timeout = !!error.timeout;
        errString = error.message || "Internal Error";
        return {
            statusCode: 500,
            timeout: timeout,
            stdout: null,
            stderr: errString
        };
    }

    // response format.  Filter errors here.
    function result(finished, startTime) {
        var responseTime = !!startTime ? Date.now()-startTime : null;
        var timeout = (finished.exitCode == 124);
        return {
            statusCode: finished.statusCode,
            exitCode: finished.exitCode,
            timeout: timeout,
            stdout: finished.stdout,
            stderr: finished.stderr,
            solutionTime: finished.duration,
            responseTime: responseTime
        }
    }

    this.createStreamForScript = function(language, script) {
        var readStrBuffer = new streamBuffers.ReadableStreamBuffer();
        var eof = '0ae290840a';
        var tmp = new Buffer(5);
        tmp.write(eof, 0, 5, 'hex');
        readStrBuffer.put(script, 'utf8');
        readStrBuffer.put(tmp, 'hex');
        codeStream = new streams.Readable().wrap(readStrBuffer);
        return codeStream;
    }

    var app = express();
    app.use(express.static(__dirname + '/public'))
        .use(express.favicon())
        .use(express.bodyParser());

    app.get('/shutdown', function(req, res) {

        var waitId;
        var shuttingDown = function() {
            var fin = arrayOfRunners.some(function(runner){ 
                return !runner.pool;
            });
            if(fin) {
                clearInterval(waitId);
                process.exit();
            } 
        };
        waitId = setInterval(shuttingDown, 400);

        arrayOfRunners.forEach(function(runner) {
            if(!runner.pool) return;
            runner.pool.drain(function() {
                console.log('Shutting down pool: '+runner.language);
                runner.pool.destroyAllNow();
                runner.pool = false;
            });
        });
    });

    app.get('/:runner/shutdown', function(req, res) {
        var lang = req.params.runner;
        if(!!runners[lang].pool) {
            runners[lang].pool.drain(function() {
                console.log('Shutting down pool: '+lang);
                runners[lang].pool.destroyAllNow();
            });
        }
    });

    app.get('/:runner/test', function(req, res) {
        var startTime = Date.now();
        runners[req.params.runner].test(function(err, job) {
            if(!!err) res.send(errResponse(err));
            else if(!job) res.send(errResponse());
            else res.send(result(job, startTime));
            
            if(!!job) job.cleanup(!!err);
        });
    });

    app.post('/:runner/run', function(req, res) {
        var startTime = Date.now();
        var cStream = createStreamForScript(req.params.runner, req.body.code);

        if(!cStream) {
            res.send(getError('Problem streaming from POST')); 
            return;
        }

        var kataId = req.query.kataId;

        var cb = function(err, job) {
            if(!!err) res.send(errResponse(err));
            else if(!job) res.send(errResponse());
            else res.send(result(job, startTime));
            
            if(!!job) job.cleanup(!!err);
        };

        runners[req.params.runner].run(cStream, cb, kataId);
    });
    app.listen(this.port);
})(config);
