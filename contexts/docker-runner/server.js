// TODO configure object, especially for host/port, etc
var docker = require('docker.io')({ socketPath: false, host: 'http://docker-bridge', port: 6969 });
var util = require('util');
var http = require('http');
var express = require('express');
var net = require('net');
var fs = require('fs');

var staticPort = 1234;
var webservicePort = 2222;

var DOCKERHOME = '/opt/docker-runner';

var runners = {
    python: 'pyrunner',
    javascript: 'noderunner',
    coffeescript: 'noderunner',
}

var cmds = {
    // TODO maybe change the entrypoint on pyrunner?
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

app.get('/:runner/run', function(req, res) {
       doRunner(req.params.runner, req.query.test);
          res.send({ status: 'not implemented'});
});

// Create another, perhaps better handler
var cmdHandler = function(err, res) {
    if(err) throw err;
        console.log("Data returned from daemon: ", res);
}

// temporary
function getTestStream(language) {
    return fs.createReadStream(DOCKERHOME+'/test/'+language+'/test.'+fileExts[language]);
}

function doRunner(language, test) {

   var image = 'codewars:'+runners[language];

   var codeStream = !!test ? getTestStream(language) : 'ERROR';

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

   docker.containers.create(options, function(err, res) {
      if(!!res.Id) {
         console.log('Container created: ', res.Id);
         var id = res.Id;
         injectCode(id, codeStream, function(err, client) {
               client.end();
               if(err) throw err;
            });
         docker.containers.start(id, function(err, res) {
            docker.containers.wait(id, function(err, data){if(err) throw err; console.log(data);});
           // console.log('container started.  Doing nothing currently');
         });
      }
   });
}

var injectCode = function(id, input, cb) {

  var client = net.connect(6969, 'docker-bridge');

  client.on('error', function(err) {
    cb(err);
  });

  client.on('connect', function() {
    client.write('POST /containers/' + id + '/attach?stdin=1&stream=1 HTTP/1.1\r\n' +
                 'Content-Type: application/vnd.docker.raw-stream\r\n\r\n');

    client.on('data', function(data) {
      console.log('data transmitted on client: \n' + data.toString());
      input.pipe(client);
    });

    client.on('finish', function() {
      cb(null, client);
    });
  });
};

var server = app.listen(webservicePort);

