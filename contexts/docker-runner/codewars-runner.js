var DockerIO = require('docker.io'),
    fs = require('fs'),
    net = require('net');

var ConfigureDocker = function(config){

    var docker = DockerIO(config.dockerOpts);

    function _makeRunner(runnerConfig) {

        var options = {
            Image: (config.repo+':'+runnerConfig.image),
            AttachStdin: true,
            OpenStdin: true,
            Tty: false,
            Env: ["RUNNER="+runnerConfig.language],
            StdinOnce: true,
            Cmd: runnerConfig.cmd
        };

        var cw = function() {
            this.docker = docker;
            this.injectCode = _injectCode;
        };
        // sets language/cmd/etc
        cw.prototype = runnerConfig; 
        cw.prototype.runOpts = options;

        cw.prototype.createJob = function(finalCB) {

            var defaultCB = function() {
                var result = {
                   statusCode: this.statusCode,
                   stdout: this.stdout,
                   stderr: this.stderr 
                }
                console.log('Job '+this.id+' finished.  No callback provided');
                console.log('Result:\n', result);
            }
            // not necessary
            var _run = function(codeStream) {
                runCode.call(this, codeStream);
            }
            var _cleanup = function() {
                var self = this;
                // TODO move this out of here or create a clojure and call internal
                var rm = function() { 
                    self.docker.containers.remove(self.id, function(err){if(err) throw err;}); 
                    self.finalCB.call(self);
                }
                _getContainerDuration.call(this, rm);
            }
            var _test = function() {
                testRunner.call(this);
            }

            var job = function(){
                this.id = undefined;
                this.stdout = '';
                this.stderr = '';
                this.statusCode = undefined;
                this.duration = null;
                this.run = _run;
                this.test = _test;
                this.finalCB = finalCB || defaultCB;
                this.cleanup = _cleanup; // out of order now
            }
            job.prototype = this;
            
            return new job();
        }

        return new cw();
    }

    function testRunner() {
        var codeStream = fs.createReadStream('test/'+this.language+'/test.'+this.extension);
        this.run(codeStream);
    }

    // this will be in the context of job
    function runCode(codeStream) {
        var self = this;
        // create, attach, start, wait, cleanup + inspect -- removing wait, going straignt to cleanup FIXME
        this.docker.containers.create(this.runOpts, function(err, res) {
            if(err) throw err; // TODO handle error with response!!!
            console.log('inside create callback');
            // TODO error implementation
           if(!!res.Id) {
              console.log('Container created: ', res.Id);
              self.id = res.Id;

              // deleted id as argument!!
              self.injectCode(codeStream, getPostInjectHandler.call(self));
           } else console.log('NO ID RETURNED FROM CREATE'); // HANDLE
        });
    }

    function getPostInjectHandler() {
        var self = this;
        return function(err, client) {
            if(err) throw err;

            client.on('end', function() {
                console.log('client socket ended');
            });

            // Going to remove wait entirely, add loop to cleanup
            self.docker.containers.start(self.id, function(err, result) {
               if(err) throw err;

/*
               self.docker.containers.wait(self.id, function(err, data) {
                   if(err) throw err;
                   self.statusCode = data.StatusCode;
                    // TODO CURRENTLY TESTING WITHOUT WAIT, MAINTAINING CLEANUP
                       // do logs in finalCB, cleanup after res.send
                   //self.finalCB.call(self);
                   self.cleanup();
               });
*/
               setTimeout(function() {
               //self.cleanup.call(self); // REMOVE BELOW
                _getContainerDuration.call(self, function() {self.finalCB.call(self);});
                
               }, 2500); // alter this instead?
            });
        }
    }

    function _getContainerDuration(cb) {
        var self = this;
        this.docker.containers.inspect(this.id, function(err, details) {
            if(err) throw err;
            if(details.State.Running) {
                setTimeout(function(){ self.cleanup.call(self); }, 1); // hopefully? change closure placement
                return;
            }

            if(!details.State.StartedAt || !details.State.FinishedAt) 
                throw "cannot get duration of a container without start/finish";
            var ss = new Date(details.State.StartedAt).getTime();
            var ff = new Date(details.State.FinishedAt).getTime();
            self.duration = (ff-ss);
            cb();
        }); 
    }


    function _injectCode (input, cb) {
        var self = this;

        var client = net.connect(config.dockerOpts.port, config.dockerOpts.hostname);

        client.on('error', function(err) {
          cb(err);
        });

        client.on('connect', function() { 
            client.write('POST /containers/' + self.id + '/attach?stdin=1&stdout=1&stderr=1&stream=1 HTTP/1.1\r\n' + 
                'Content-Type: application/vnd.docker.raw-stream\r\n\r\n');
            client.on('data', function(data) { 
                if(typeof input.nogo === 'undefined' || !input.nogo) 
                input.pipe(client);
                else { 
                    // Demuxing Stream
                    while(data !== null) {
                        var type = data.readUInt8(0);
                        console.log('type is : '+type);
                        var size = data.readUInt32BE(4);
                        console.log('size is : '+size);
                        var payload = data.slice(8, size+8);
                        console.log('payload is: '+payload);
                        if(type == 2) self.stderr += payload;
                        else self.stdout += payload;
                        data = null; // no chunking so far
                     }
                } 
            });

            client.on('finish', function() {
                input.nogo = true;
                cb(null, client); 
            });
        });
    }

    return { createRunner: _makeRunner }
};

module.exports = ConfigureDocker;
