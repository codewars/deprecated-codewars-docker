var DockerIO = require('docker.io'),
    poolModule = require('generic-pool'),
    util = require('util'),
    streams = require('stream'),
    streamBuffers = require('stream-buffers'),
    fs = require('fs'),
    net = require('net');

var TIMEOUT = 3200; // some wiggle room for load
var MAX_RETRY = 50;
//var RETRY_GROWTH_FACTOR = 2;
var RETRY_GROWTH_FACTOR = 0; // sets delay to 1 ms
// if at any point we receive confusing errors,
// setting useLevel = MAX_USE will mark the container
// for destruction.
var MAX_USE = 1000;

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

    // FIXME
    config.version = config.version || 'v1.10';

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
                // FIXME remove double strategy, stick with one
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

            // any changing criteria for last ditch log recovery attempt
            var _isRecovery = function() {
                return this.retryCount >= MAX_RETRY;
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
                this.isRecovery = _isRecovery;
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
            var self = job;

            var oClient = net.connect(config.dockerOpts.port, config.dockerOpts.hostname, function() {
                self.oClient = oClient;

                oClient.on('error', function(err) {
                   self.report('oClient socket error: '+err);
                });

                oClient.on('readable', function() {
                    self.report('oClient received readable');
                });

                oClient.on('data', function(data) {
                    if(self.state === NEW) return;

                    //self.report('oClient data received ' + data);
                    data.toString(); // read from buffer
                    self.report('oClient data received ');

                    var success = false;
                    if(self.state === ACCUMULATE) {
                        if(!job.partial) job.finalCB(new Error('Chunked stream from container failed.'), job);
                        var merged = Buffer.concat([job.partial, data]);
                        success = extractPayload(self, merged);
                        //success = extractPayload(self, data);
                    } else success = extractPayload(self, data);

                    if(success) {
                        self.duration = (Date.now() - self.injectTime);
                        self.state = FINISHED;
                        self.finalCB(null, self);
                    }
                });

                oClient.on('finish', function() {
                    self.instrument('oClient socket finished');
                });

                oClient.on('end', function() {
                    self.instrument('oClient socket ended');
                });

                var sin, sout, serr;
                sin='0';
                sout = serr = '1';

                // TODO remove content-type
                oClient.write('POST /'+config.version+'/containers/' + self.id + '/attach?stdin='+sin+'&stdout='+sout+'&stderr='+serr+'&stream=1 HTTP/1.1\r\n' +
                    'Content-Type: application/vnd.docker.raw-stream\r\n\r\n');
            });

            return oClient;
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
                console.log('WHAT THE HECK');
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
        try {
            //job.report('Attempting to parse json:\n'+payload);
            var json = JSON.parse(payload);
            if(!!json.stdout) job.stdout = json.stdout;
            if(!!json.stderr) job.stderr = json.stderr;
            if(typeof json.exitCode !== 'undefined') job.exitCode = json.exitCode;
            return true;
        } catch(jx) {
            job.report(jx);
            //job.finalCB(jx, job);
            return false;
        }
    }

    function extractPayload(job, data) {

        var type = data.readUInt8(0);
        job.report('type is : '+type);
        var size = data.readUInt32BE(4);
        job.report('data size is : '+data.length);
        job.report('size is : '+size);

        var expected = size + 8;
        if(expected <= data.length) {
            payload = data.slice(8, size+8);
            //job.report('payload is: '+payload);

            var success = false;
            if(type == 2) job.stderr += payload;
            else if(type == 1) {
                success = parseJSON(job, payload);
            }
            else job.finalCB(new Error('Invalid stream from container'), job);

            //return true;
            
            // We now have to handle concatting two chunked streams via while loop
            if(!success) job.partial = data;
            return success;
        } else if(expected > data.length) {
            job.state = ACCUMULATE;
            job.partial = data;
            job.report('data is chunked, waiting for payload to complete');
        } else job.finalCB(new Error('Invalid payload length from container'), job);

        return false;
    }

    // Logs would require a smart extraction + placeholder if ongoing
    function recoverLogs(job, data) {
        var detailStr = util.format("data=%d pointer=%d", data.length, job.logBytes);
        job.instrument("Attempting log recovery: "+detailStr);

        if(data.length < job.logBytes+8) extractPayload(job, data);
        else extractPayload(job, data.slice(job.logBytes));
    }

    function _injectCodeOrMonitor(codeStream) {
        var self = this;

        var client = net.connect(config.dockerOpts.port, config.dockerOpts.hostname, function() {
            self.client = client;

            client.on('error', function(err) {
               self.finalCB(err, self);
            });

            client.on('data', function(data) {
                self.report('data received ' + data);
                switch(self.state) {
                    case NEW: 
                        self.instrument('injecting code');
                        self.injectTime = Date.now();
                        codeStream.pipe(client);
                        break;
                }
            });

            // code has been injected
            // TODO remove state completely
            client.on('finish', function() {
                self.instrument('client socket finished');
                self.state = WAITING;
                self.client.destroy();
                delete self.client;
                delete client;
            });

            client.on('end', function() {
                self.instrument('client socket ended');
            });

            var sin, sout, serr;
            sin='1';
            sout = serr = '0';

            client.write('POST /'+config.version+'/containers/' + self.id + '/attach?stdin='+sin+'&stdout='+sout+'&stderr='+serr+'&stream=1 HTTP/1.1\r\n' +
                'Content-Type: application/vnd.docker.raw-stream\r\n\r\n');
        });

        return client;
    }

    return { createRunner: _makeRunner }
};

module.exports = ConfigureDocker;
