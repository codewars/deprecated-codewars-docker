var DockerIO = require('docker.io'),
    poolModule = require('generic-pool'),
    util = require('util'),
    fs = require('fs'),
    net = require('net');

// useLevel not currently used
var MAX_USE = 1000;

var STDOUT=1, STDERR=2;
var states = [];
var NEW = 0,
    RETRY = 1,
    WAITING = 2,
    ACCUMULATE = 3,
    FINISHED = 4,
    RECOVERY = 5,
    FAIL = 6;
var stateNames = ['NEW', 'RETRY', 'WAITING', 'ACCUMULATE', 'FINISHED', 'RECOVERY', 'FAIL'];

var ConfigureDocker = function(config){

    var docker = DockerIO(config.dockerOpts);

    function defaultCB(err, job) {
        var result = {
            statusCode: job.statusCode,
            exitCode: job.exitCode,
            stdout: job.stdout,
            stderr: job.stderr 
        }
        console.log('Job '+job.id+' finished.  No callback provided');
        console.log('Result:\n', result);
    }


    function _makeRunner(runnerConfig) {

        var options = {
            Image: (config.repo+':'+runnerConfig.image),
            AttachStdin: true,
            AttachStdout: true,
            AttachStderr: true,
            OpenStdin: true,
            Tty: false,
            Env: ["RUNNER="+runnerConfig.language],
            StdinOnce: false,
            Cmd: runnerConfig.cmd
        };

        // Prototype chain is such that job shares all functionality
        var cw = function() {
            this.docker = docker;
        };

        // sets language/cmd/etc
        cw.prototype = runnerConfig; 
        cw.prototype.runOpts = options;

        cw.prototype.test = function(finalCB) {
            var runnerThis = this;
            var testFilePath = 'test/'+this.language+'/test.'+this.extension;
            var codeStream = fs.createReadStream(testFilePath);
            fs.stat(testFilePath, function(err, stat) {
                if(err) throw err;
                codeStream.inputSize = stat.size; 
                runnerThis.run(codeStream, finalCB);
            });
        };

        cw.prototype.run = function(codeStream, finalCB) {
            this.pool.acquire(function(err, job){
                if(err) throw err; 
                job.initialTime = Date.now();
                job.finalCB = finalCB;
                job.injectCodeOrMonitor(codeStream, finalCB);
            });
        };

        // do not call this directly anymore if using pool
        cw.prototype.createJob = function() {


            var _cleanup = function(healthCheck) {
                var job = this;

                if(!!healthCheck) {
                    performHealthCheck(job);
                    return; // we will resume after inspect
                }

                if(job.useLevel < MAX_USE) {
                    job.report('releasing container...');
                    job.stdout = '';
                    job.stderr = '';
                    if(!!job.client) {
                        job.client.destroy();
                        delete job.client;
                    }

                    delete job.injectTime;
                    delete job.solutionTime;
                    delete job.finalCB;
                    delete job.duration;
                    delete job.responseTime;
                    delete job.exitCode;
                    delete job.partial;

                    job.statusCode = 200;
                    job.state = NEW;
                    job.retryCount = 0;
                    job.finalCB = job.defaultCB;

                    job.pool.release(this); 
                } else {
                    job.report('removing container at use='+job.useLevel);
                    job.pool.destroy(this);
                }
            };

            var _instrument = function(optMessage) {
                var reportString = optMessage || '';
                if(!!this.initialTime) {
                    this.curTime = this.curTime || this.initialTime;
                    var now = Date.now();
                    var reportString = util.format('total=%d block=%d %s', 
                            (now-this.initialTime), (now-this.curTime), reportString);
                    this.curTime = now; 
                } 

                this.report(reportString);
            }

            var _report = function(optMessage) {
                var state = this.state >= WAITING && this.retryCount > 0 ? 
                    util.format('%s (RETRY #%d)', stateNames[this.state], this.retryCount) : stateNames[this.state];
                var id = !!this.id ? this.id.substring(0,13) : 'NONE';
                console.log('job %s: %s %s', id, state, optMessage);
            }
            
            var job = function(){

                // ==========
                // SOCKET FIX
                this.oClient = undefined;
                // change to iClient?
                this.Client = undefined;
                // ==========

                this.id = undefined;
                this.stdout = '';
                this.stderr = '';
                this.state = NEW;
                this.useLevel = 0;
                this.retryCount = 0;
                this.logBytes = 0;
                this.statusCode = 200;
                this.exitCode = undefined;
                this.duration = null;
                this.initialTime = undefined;
                this.curTime = undefined;
                this.injectCodeOrMonitor = _injectCodeOrMonitor;
                this.finalCB = defaultCB;
                this.instrument = _instrument;
                this.report = _report;
                this.cleanup = _cleanup;
            }
            job.prototype = this;
            
            return new job();
        }

        function attachStdListener(job) {

            var onData = function (data) {
                if(job.state === NEW) return;

                //job.report('oClient data received ' + data);
                data.toString(); // read from buffer
                job.report(util.format('%s data received - length: %d', 
                        this.name, data.length));

                if(!job.partial || !job.partial.cur) {
                    job.report('checking header');
                    data = consumeHeader(job, data);
                } else job.report('ignoring header');

                job.state = ACCUMULATE;
                try {
                    var goodJSON = false;
                    var looksComplete = extractPayload(job, data);
                    if(looksComplete) {
                        if(!!job.partial.out) {
                            try {
                                goodJSON = parseJSON(job, job.partial.out)
                            } catch(ex) {
                                // more data is probably on the wire
                                job.report('parse failed: '+ex);
                                delete job.partial.cur;
                            }

                            if(goodJSON) {
                                job.duration = (Date.now() - job.injectTime);
                                job.state = FINISHED;
                                job.finalCB(null, job);
                            }

                        } else if(!!job.partial.stderr) {
                            job.statusCode = 500;
                            job.exitCode = -1;
                            job.state = FAIL;
                            job.stderr = job.partial.stderr;
                        }
                    }
                } catch(extractException){
                    job.statusCode = 500;
                    job.exitCode = -1;
                    job.state = FAIL;
                    job.report('Sending 500 to client: '+extractException);
                    job.finalCB(extractException, job);
                }
            };

            var oClient = getClientForContainer(job, true, { data: onData });
        }

        var thisRunner = new cw();
        if(!!runnerConfig.pool) {
            thisRunner.pool = poolModule.Pool({
                name: 'docker-' + thisRunner.image + '-pool',
                create: function(callback) {
                    var job = thisRunner.createJob();
                    thisRunner.docker.containers.create(thisRunner.runOpts, function(err, res) {
                        if(!err) {
                            if(!!res.Id) {
                                job.id = res.Id;
                                thisRunner.docker.containers.start(job.id, function(err, result) {
                                   if(err) throw err;
                                   attachStdListener(job);
                                   callback(job);
                                });
                            } else callback(new Error('No ID returned from docker create'), null);
                        } else callback(err, null);
                    });

                },
                destroy: function(job) {
                    job.report('self destruct');
                    // TODO make synchronous, but handle requests-in-progress
                    // try setTimeout so pool can get back to business
                    setTimeout(function() {
                        job.docker.containers.kill(job.id, function(err) {
                            if(err) {
                                job.report('Container could not be killed', err);
                                // Remote API v0.10 allows forced removal
                                delete job;
                            } else {
                                job.docker.containers.remove(job.id, function(err) {
                                    if(err) job.report('Container could not be removed', err);
                                    delete job;
                                });
                            }
                        });
                    }, 10);
                },
                //idleTimeoutMillis: 9000000,
                refreshIdle: false,
                max: 3,
                min: 1, 
                log: false // can also be a function
            });

            // TODO remove all containers from separate list?
            function gracefulExit() {
                thisRunner.pool.drain(function() {
                    thisRunner.pool.destroyAllNow();
                });
            }

            process.on('SIGINT', gracefulExit)
                .on('SIGTERM', gracefulExit);
        }
        return thisRunner;
    }

    // perform health check after timeout
    function performHealthCheck(job) {
        job.instrument('Job failed, inspecting container');

        job.docker.containers.inspect(job.id, function(err, details) {
            if(err) job.report('Health check error', err);

            if(err || !details.State.Running) {
                errMsg = util.format('Health Check: %s', (err? err.message : 'container is not running/responding'));
                job.report(errMsg);
                job.useLevel = MAX_USE;
            }

            job.cleanup();
        });
    }

    function parseJSON(job, payload) {
        //job.report('Attempting to parse json:\n'+payload);
        var json = JSON.parse(payload);
        if(!!json.stdout) job.stdout = json.stdout;
        if(!!json.stderr) job.stderr = json.stderr;
        if(typeof json.exitCode !== 'undefined') job.exitCode = json.exitCode;
        return true;
    }

    // Has side effects!!
    function consumeHeader(job, data) {
        if(!job.partial) job.partial = {out: '', err: ''};
        var cur = {
            type: data.readUInt8(0),
            expected: data.readUInt32BE(4),
            size: 0
        }
        job.report('current type is : '+ cur.type);
        job.report('expected size is : '+ cur.expected);

        var prev = job.partial.cur;

        if(!!prev) {
            if(prev.type !== cur.type)
                job.report(util.format('Stream switching from %d to %d', prev.type, cur.type));

            //if(prev.size === 0 || cur.type > 2) {
            // This was a problem during double recur
            if(cur.type > 2) {
                job.report('Header seems to have been consumed... ignoring "header"');
                return;
            }
        }
        job.partial.cur = cur;
        return data.slice(8, data.length); // remove header
    }


    function extractPayload(job, data) {
        var looksComplete = false;
        var cutoff; // multiplex may cutoff inside a TCP chunk

        if(!job.partial || !job.partial.cur)
            throw new Error('Partial not set');
        var cur = job.partial.cur;
        
        // if not recur cur.size should be 0
        var L = data.length + cur.size;
        if(cur.expected == L) looksComplete = true;

        var payload = cur.expected >= L ? data.toString('utf8') :
            data.slice(0, cutoff=(cur.expected - cur.size)).toString();

        //job.report('payload set to: '+payload);

        if(cur.type === STDOUT) job.partial.out += payload;
        else if(cur.type === STDERR) job.partial.err += payload;
        else throw new Error('Bad stream type');

        if(cur.expected > L) cur.size += data.length;

        if(cur.expected < L) {
            data = data.slice(cutoff, data.length);
            job.report('recurring due to early payload cutoff');
            job.report('new length is '+data.length);
            data = consumeHeader(job, data);
            looksComplete = extractPayload(job, data); // recur
        }

        return looksComplete;
    }

    // Logs would require a smart extraction + placeholder if ongoing
    function recoverLogs(job, data) {
        var detailStr = util.format("data=%d pointer=%d", data.length, job.logBytes);
        job.instrument("Attempting log recovery: "+detailStr);

        if(data.length < job.logBytes+8) extractPayload(job, data);
        else extractPayload(job, data.slice(job.logBytes));
    }


    function getClientForContainer(job, isOutput, handlers) {
        var name = isOutput ? 'oClient' : 'client'; // for logs

        if(!handlers['data']) throw new Error('data handler not provided');

        var onData = handlers['data'];
        var onError = handlers['error'] || function(err) {
            job.report(util.format('%s socket error: %s', name, err));
        };
        var onRead = handlers['readable'] || function() { 
            job.report(util.format('%s socket received readable', name));
        };
        var onFinish = handlers['finish'] || function() {
            job.report(util.format('%s socket finished', name));
        };
        var onEnd = handlers['end'] || function() {
            job.instrument(util.format('%s socket ended', name));
        }

        var newClient = net.connect(config.dockerOpts.port, config.dockerOpts.hostname, function() {
            // only until we verify clojure under load
            // earlier release had problems with gc
            if(isOutput) job.oClient = newClient;
            else job.client = newClient;

            newClient.name = name;

            newClient.on('error', onError);
            newClient.on('readable', onRead);
            newClient.on('data', onData);
            newClient.on('finish', onFinish);
            newClient.on('end', onEnd);

            var sin, sout, serr;
            sin = isOutput ? '0' : '1';
            sout = serr = isOutput ? '1' : '0';

            newClient.write('POST /'+config.dockerOpts.version+'/containers/' + job.id + '/attach?stdin='+sin+'&stdout='+sout+'&stderr='+serr+'&stream=1 HTTP/1.1\r\n' +
                'Content-Type: application/vnd.docker.raw-stream\r\n\r\n');
        });

        return newClient;
    }

    function _injectCodeOrMonitor(codeStream) {
        var self = this;

        var onError = function(err) {
            self.finalCB(err, self);
        };

        var onData = function(data) {
                self.report('data received ' + data);
                switch(self.state) {
                    case NEW: 
                        self.instrument('injecting code');
                        self.injectTime = Date.now();
                        codeStream.pipe(self.client);
                        break;
                    default:
                        self.
                        break;
                }
        };

        // code has been injected
        var onFinish = function() {
            self.instrument('client socket finished');
            self.state = WAITING;
            self.client.destroy();
            delete self.client;
            delete client;
        };

        var injectHandlers = {
            error: onError,
            data: onData,
            finish: onFinish
        };

        var injectClient = getClientForContainer(self, false, injectHandlers);
    }

    return { createRunner: _makeRunner }
};

module.exports = ConfigureDocker;
