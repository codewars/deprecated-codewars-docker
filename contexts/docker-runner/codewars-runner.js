var DockerIO = require('docker.io'),
    fs = require('fs'),
    net = require('net');

var ConfigureDocker = function(config){

//    var docker = require('docker.io')({ socketPath: false, host: 'http://docker-bridge', port: 6969 });
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
            var _test = function() {
                testRunner.call(this);
            }

            var job = function(){
                this.id = undefined;
                this.stdout = '';
                this.stderr = '';
                this.statusCode = undefined;
                this.run = _run;
                this.test = _test;
                this.finalCB = finalCB || defaultCB;
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
        console.log('what about runCode? '+typeof self.docker);
        // create, attach, start, wait
        this.docker.containers.create(this.runOpts, function(err, res) {
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
        console.log('does it exist HERE?? '+typeof self.docker);
        return function(err, client) {
            if(err) throw err;

            client.on('end', function() {
                console.log('client socket ended');
            });

            self.docker.containers.start(self.id, function(err, result) {
               if(err) throw err;

               self.docker.containers.wait(self.id, function(err, data) {
                   if(err) throw err;
                   self.statusCode = data.StatusCode;
                   self.finalCB.call(self);
               });
            });
        }
    }

    function _injectCode (input, cb) {
        var self = this;
        console.log('does it exist inside inject? '+typeof self.docker);

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
