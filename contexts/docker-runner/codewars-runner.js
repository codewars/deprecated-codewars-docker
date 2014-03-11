/* We had a ready setup where did setupInject on create and then after every attach
*  Now for debugging we are doing setupInject just before attach
*/ 
var DockerIO = require('docker.io'),
    poolModule = require('generic-pool'),
    util = require('util'),
    streams = require('stream'),
    streamBuffers = require('stream-buffers'),
    fs = require('fs'),
    net = require('net');

// MOVE INTO JOB PROTO
var states = [];
var INPUT_NEW = 0,
    RETRY = 1,
    WAITING = 2,
    FINISHED = 3;
var stateNames = ['INPUT_NEW', 'RETRY', 'WAITING', 'FINISHED'];


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
            //this.injectCode = _injectCode; // try closing over client
            //this.postInject = _postInjectHandlerReattach;
            this.postInject = function() { this.report('fake postInject callback, SHOULD NOT BE CALLED'); };
            //this.postInject = function() { this.cleanup.call(this);};
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
                //_setupOutput.call(job, {});
            });
        };

        cw.prototype.run = function(codeStream, cfinalCB) {
            this.pool.acquire(function(err, job){
                if(err) throw err; 
                job.stdout = '';
                job.stderr = '';
                job.initialTime = Date.now();
                job.finalCB = cfinalCB;
                job.state = INPUT_NEW;
                job.retryCount = 0;
                job.report('job acquired');
                job.injectCode(codeStream);
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

            // TODO verify clean/dirty state conditions
            var _cleanup = function() {
                this.finalCB.call(this);
                this.report('releasing container...');
                this.pool.release(this); 
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
                this.id = undefined;
                this.stdout = '';
                this.stderr = '';
                this.state = INPUT_NEW;
                this.retryCount = 0;
                this.statusCode = undefined;
                this.duration = null;
                this.initialTime = undefined;
                this.curTime = undefined;
                this.injectCode = _injectCode;
                this.finalCB = defaultCB;
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
                    console.log('DESTROYING '+job.id+' although container may not be removed!')
                },
                idleTimeoutMillis: 9000000,
                refreshIdle: false,
                max: 60,
                min: 30, 
                log: false // can also be a function
            });
        }
        return thisRunner;
    }

/*
    // After we encounter this, we may want to release the job 
    // back into the pool instead of destroying it - depends on use case
    function _postInjectHandlerInspect(err, client) {
        if(err) throw err;

        var self = this;
        this.instrument('inject completed, calling inspect directly');
        this.docker.containers.inspect(this.id, function(err, details) {
            if(err) throw err;
            self.instrument('inspect returned');

            if(!!details.State.Running) {
                self.report('Inspect after finish returned running!');
                // is this wise under load?
                self.postInject(null, client);
                return;
            }

            if(!details.State.StartedAt || !details.State.FinishedAt)  {
                self.report("cannot get duration of a container without start/finish");
            } else {
                var ss = new Date(details.State.StartedAt).getTime();
                var ff = new Date(details.State.FinishedAt).getTime();
                self.duration = (ff-ss);
            }
            self.statusCode = details.StatusCode;
            self.cleanup();
        }); 
    }

    function _postInjectHandlerWait(err, client) {
        if(err) throw err;

        var self = this;
        this.instrument('inject completed, about to wait container');
           self.docker.containers.wait(self.id, function(err, data) {
               if(err) throw err;
               self.instrument('Container returned from wait with statusCode', data.statusCode);
               self.statusCode = data.StatusCode;
                   // do logs in finalCB, cleanup after res.send
               self.cleanup();
           });
    }

    function _postInjectHandlerStart(err, client) {
        if(err) throw err;

        var self = this;
        this.instrument('inject completed, about to start container');
        this.docker.containers.start(self.id, function(err, result) {
           if(err) throw err;
           self.instrument('Container started, about to wait!!!');

           self.docker.containers.wait(self.id, function(err, data) {
               if(err) throw err;
               self.instrument('Container returned from wait with statusCode', data.statusCode);
               self.statusCode = data.StatusCode;
                   // do logs in finalCB, cleanup after res.send
               self.cleanup();
           });
        });
    }
*/

    // Logs would require a smart extraction + placeholder if ongoing
    function extractPayload(job, data) {
        job.instrument('extracting payload');
        while(data !== null) {
            var payload = '';
            if(job.runOpts.Tty) {
                payload = data.slice(); 
                //job.report('payload type: ' + (typeof payload));
                job.stdout += payload;
            } else {
                var type = data.readUInt8(0);
                //job.report('type is : '+type);
                var size = data.readUInt32BE(4);
                //job.report('data size is : '+data.length);
                //job.report('size is : '+size);
                payload = data.slice(8, size+8);
                //job.report('payload is: '+payload);
                if(payload == null) break;
                if(type == 2) job.stderr += payload;
                else if(type == 1) job.stdout += payload;
                else job.report('Problem with streaming API - check version in config!\nDiscarding...');
            }
            data = null; // only loop for log traversal
        }
    }

    function _injectCode(codeStream) {
        var self = this;

        var client = net.connect(config.dockerOpts.port, config.dockerOpts.hostname, function() {

            client.on('error', function(err) {
               self.report('error on socket: ', err);
               // cb(err);
            });

            client.on('data', function(data) {
                self.report('Data received ' + data);
                switch(self.state) {
                    case INPUT_NEW: 
                        self.instrument('injecting code');
                        codeStream.pipe(client);
                        break;
                    case RETRY:
                        self.instrument('retry attempted');
                        self.state = WAITING;
                        break;
                    case WAITING:
                        extractPayload(self, data);
                        self.state = FINISHED;
                        self.client.end();
                        break;
                }
            });

            // code has been injected
            client.on('finish', function() {
                self.instrument('client socket finished');
                switch(self.state) {
                    case INPUT_NEW:
                        self.state = WAITING;
                        client.resume();
                        break;
                    case FINISHED:
                        self.client.destroy();
                        delete self.client;
                        self.cleanup();
                        break;
                }
            });

            client.on('end', function() {
                self.instrument('client socket ended');
                switch(self.state) {
                    case WAITING:
                        self.client.destroy();
                        delete self.client;
                        if(self.retryCount <= 2) {
                            self.state = RETRY;
                            self.retryCount++;
                            self.injectCode(codeStream);
                        } else {
                            // TODO
                            self.cleanup();
                        }
                        break;
                }
            });

            var sin, sout, serr;
            sin = self.state === INPUT_NEW ? '1' : '0';
            sout = serr = '1';
            client.write('POST /'+config.version+'/containers/' + self.id + '/attach?stdin='+sin+'&stdout='+sout+'&stderr='+serr+'&stream=1 HTTP/1.1\r\n' +
                'Content-Type: application/vnd.docker.raw-stream\r\n\r\n');
        });

        self.client = client;
        // make this a callback instead like before
        return client;
    }

    return { createRunner: _makeRunner }
};

module.exports = ConfigureDocker;
