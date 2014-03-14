var DockerIO = require('docker.io'),
    poolModule = require('generic-pool'),
    util = require('util'),
    streams = require('stream'),
    streamBuffers = require('stream-buffers'),
    fs = require('fs'),
    net = require('net');

var TIMEOUT = 3200; // some wiggle room for load
var MAX_RETRY = 20;
//var RETRY_GROWTH_FACTOR = 5;
var RETRY_GROWTH_FACTOR = 0; // sets delay to 1 ms
// if at any point we receive confusing errors,
// setting useLevel = MAX_USE will mark the container
// for destruction.
var MAX_USE = 50;

var states = [];
var NEW = 0,
    RETRY = 1,
    WAITING = 2,
    FINISHED = 3;
var stateNames = ['NEW', 'RETRY', 'WAITING', 'FINISHED'];


var ConfigureDocker = function(config){

    // FIXME
    //config.version = config.version || 'v1.10';
    config.version = config.version || 'v1.8';

    var docker = DockerIO(config.dockerOpts);


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
                job.injectCodeOrMonitor(codeStream, finalCB);
            });
        };

        // do not call this directly anymore if using pool
        cw.prototype.createJob = function() {

            var defaultCB = function() {
                var result = {
                   statusCode: this.statusCode,
                   stdout: this.stdout,
                   stderr: this.stderr 
                }
                console.log('Job '+this.id+' finished.  No callback provided');
                console.log('Result:\n', result);
            }

            var _cleanup = function(healthCheck) {
                var job = this;

                if(!!healthCheck) 
                    performHealthCheck(job);

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
                    delete job.duration;
                    delete job.responseTime;
                    job.state = NEW;
                    job.retryCount = 0;
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
                this.id = undefined;
                this.stdout = '';
                this.stderr = '';
                this.state = NEW;
                this.useLevel = 0;
                this.retryCount = 0;
                this.statusCode = undefined; // FIXME
                this.duration = null;
                this.initialTime = undefined;
                this.curTime = undefined;
                this.isRecovery = _isRecovery;
                this.injectCodeOrMonitor = _injectCodeOrMonitor;
                this.defaultCB = defaultCB;
                this.instrument = _instrument;
                this.report = _report;
                this.cleanup = _cleanup;
            }
            job.prototype = this;
            
            return new job();
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
                                   callback(job);
                                });
                            } else callback(new Error('No ID returned from docker create'), null);
                        } else callback(err, null);
                    });

                },
                destroy: function(job) {
                    job.report('self destruct');
                    job.docker.containers.kill(job.id, function(err) {
                        if(err) {
                            job.report('Container could not be killed', err);
                            // TODO Remote API v0.10 allows forced removal
                            delete job;
                        } else {
                            job.docker.containers.remove(job.id, function(err) {
                                if(err) job.report('Container could not be removed', err);
                                delete job;
                            });
                        }
                    });
                },
                //idleTimeoutMillis: 9000000,
                refreshIdle: false,
                max: 60,
                min: 40, 
                log: false // can also be a function
            });
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

    // Logs would require a smart extraction + placeholder if ongoing
    function extractPayload(job, data) {
        job.instrument('extracting payload');
        while(data !== null) {
            var payload = '';
            if(job.runOpts.Tty) {
                payload = data.slice(); 
                job.report('payload type: ' + (typeof payload));
                job.stdout += payload;
            } else {
                var type = data.readUInt8(0);
                job.report('type is : '+type);
                var size = data.readUInt32BE(4);
                job.report('data size is : '+data.length);
                job.report('size is : '+size);
                payload = data.slice(8, size+8);
                job.report('payload is: '+payload);
                if(payload == null) break;
                if(type == 2) job.stderr += payload;
                else if(type == 1) job.stdout += payload;
                else job.report('Problem with streaming API - check version in config!\nDiscarding...');
            }
            data = null; // only loop for log traversal
        }
    }

    function retryRecoverFail(job, codeStream, cb) {
        job.client.destroy();
        delete job.client;
        if(!job.isRecovery()) {
            job.state = RETRY;
            // Delay will inrease with each retry.
            var timeRemaining = TIMEOUT-(Date.now()-job.injectTime);
            var delay = Math.pow(job.retryCount++, RETRY_GROWTH_FACTOR);
            if(timeRemaining < delay) {
                delay = timeRemaining;
                job.retryCount = MAX_RETRY+100; // to obviate in logs
            }
            job.report('waiting '+delay+'ms to retry');
            setTimeout(function() {
                job.injectCodeOrMonitor(codeStream, cb);
            }, delay);
        } else {
            var toError = new Error("Code timed out");
            toError.timeout = true;
            cb(toError, job);
        } 
    }

    function _injectCodeOrMonitor(codeStream, CB) {
        var self = this;
        CB = CB || self.defaultCB;

        var client = net.connect(config.dockerOpts.port, config.dockerOpts.hostname, function() {
            self.client = client;

            client.on('error', function(err) {
               CB(err, self);
            });

            client.on('data', function(data) {
                self.report('data received ' + data);
                switch(self.state) {
                    case NEW: 
                        self.instrument('injecting code');
                        self.injectTime = Date.now();
                        codeStream.pipe(client);
                        break;
                    case RETRY:
                        self.instrument('retry attempted');
                        self.state = WAITING;
                        self.client.setTimeout(200, function(){
                            self.instrument('socket idle timeout');
                            retryRecoverFail(self, codeStream, CB);
                        });
                        break;
                    case WAITING:
                        extractPayload(self, data);
                        self.duration = Date.now() - self.injectTime;
                        self.state = FINISHED;
                        self.client.end();
                        break;
                }
            });

            // code has been injected
            client.on('finish', function() {

                self.instrument('client socket finished');
                switch(self.state) {
                    case NEW:
                        self.state = WAITING;
                        client.resume();
                        break;
                    case FINISHED:
                        self.client.destroy();
                        delete self.client;
                        CB(null, self);
                        break;
                }
            });

            client.on('end', function() {
                self.instrument('client socket ended');
                switch(self.state) {
                    case WAITING:
                        if(!self.isRecovery()) {
                            retryRecoverFail(self, codeStream, CB);
                        } else CB(new Error('Unusual state'), self);
                        break;
                }
            });

            var sin, sout, serr;
            sin = self.state === NEW ? '1' : '0';
            sout = serr = '1';
            var slogs = ''; // no more log traversal attempts
//            var slogs = self.isRecovery() ? 'logs=1&' : '';

            client.write('POST /'+config.version+'/containers/' + self.id + '/attach?'+slogs+'stdin='+sin+'&stdout='+sout+'&stderr='+serr+'&stream=1 HTTP/1.1\r\n' +
                'Content-Type: application/vnd.docker.raw-stream\r\n\r\n');
        });

        return client;
    }

    return { createRunner: _makeRunner }
};

module.exports = ConfigureDocker;
