// TODO configure object, especially for host/port, etc
var bridge = 'localhost';
var DOCKERHOME = '/home/synapse/Desktop/codewars-docker/contexts/docker-runner';
var docker = require('docker.io')({ socketPath: false, host: 'http://'+bridge, port: 6969 });
var util = require('util');
var http = require('http');
var express = require('express');
var streams = require('stream');
var streamBuffers = require('stream-buffers');
var decoder = new (require('string_decoder').StringDecoder)('utf-8')
var net = require('net');
var fs = require('fs');


var staticPort = 1234;
var webservicePort = 2222;

var runners = {
    python: 'pyrunner',
    javascript: 'noderunner',
    coffeescript: 'noderunner',
}

var cmds = {
    python: ['/usr/local/bin/run', '/opt/ve/pyrunner/bin/python', '/opt/apps/pyrunner/run.py'],
    javascript: ['/usr/local/bin/run'],
    coffeescript: ['/usr/local/bin/run']
}

var fileExts = {
    python: 'py',
    javascript: 'js',
    coffeescript: 'coffee',
}

var app = express();
app.use(express.static(__dirname + '/public'))
    .use(express.favicon())
    .use(express.bodyParser());



function getError(errString) {
    return {
        StatusCode: 500,
        stdout: null,
        stderr: errString
    };
}

// change test url
app.get('/:runner/run', function(req, res) {
    if(req.query.test) { 
        var cStream = getTestStream(req.params.runner);
        if(typeof cStream === 'undefined') {
            var problem = getError('Unable to stream test scripts');
            res.send(problem);
        } else doRunner(req.params.runner, cStream);
        var notYet = getError('Implementation Pending');
        notYet.stdout = 'Correctly handled input';
        res.send(notYet);
    }
    res.send(getError('Invalid request'));
});

app.post('/:runner/run', function(req, res) {
        var cStream = createStreamForScript(req.params.runner, req.body.code);
       if(typeof cStream === 'undefined') {
           var problem = getError('Problem streaming from POST');
           res.send(problem);
       } else doRunner(req.params.runner, cStream);
        var notYet = getError('Implementation Pending');
        notYet.stdout = 'Correctly handled input';
        res.send(notYet);
});

// Currently broken, possibly race condition
function getTestStream(language) {
    return fs.createReadStream(DOCKERHOME+'/test/'+language+'/test.'+fileExts[language]);
}

function createStreamForScript(language, script) {
    var readStrBuffer = new streamBuffers.ReadableStreamBuffer();
    readStrBuffer.put(script, 'utf8');
    codeStream = new streams.Readable().wrap(readStrBuffer);
    codeStream.on('error', function(err) {console.log('INPUT had an error: '+err);});
    return codeStream;
}

function doRunner(language, codeStream) {

    var oString = '';
    var errString = '';

    var image = 'codewars:'+runners[language];

   var options = {
      Image: image,
      AttachStdin: true,
      OpenStdin: true,
      Tty: false,
      Env: ["RUNNER="+language],
      StdinOnce: true,
      Cmd: cmds[language], // TODO test defaults.
      ExposedPorts: {
         "1234/tcp": {}
      }
   };

        function injectCode(id, input, cb) {

          var client = net.connect(6969, bridge);

          client.on('error', function(err) {
            cb(err);
          });

          client.on('connect', function() {
            client.write('POST /containers/' + id + '/attach?stdin=1&stdout=1&stderr=1&stream=1 HTTP/1.1\r\n' +
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
                       if(type == 2) errString += payload;
                       else oString += payload;
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

   // create, attach, start, wait
   docker.containers.create(options, function(err, res) {

      if(!!res.Id) {
         console.log('Container created: ', res.Id);
         var id = res.Id;

         injectCode(id, codeStream, function(err, client) { 
             if(err) throw err;

             client.on('end', function() {
                 console.log('client socket ended');
             });

             docker.containers.start(id, function(err, result) {
                if(err) throw err;

                docker.containers.wait(id, function(err, data) {
                    if(err) throw err;
                    var statusOnly = false;
                    if(statusOnly) console.log(data); // CHANGE: res.send(data);
                    var everything = {
                        StatusCode: data.StatusCode,
                        stdout: oString,
                        stderr: errString
                    }
                    console.log(everything);
                });

             });
         });
      } else console.log('NO ID RETURNED FROM CREATE'); // HANDLE
   });
}

var server = app.listen(webservicePort);
