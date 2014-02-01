var config = {
    // [baseDir:] /some/path/to/base/ (ending-slash)
    port: 2222,
    repo: 'codewars'
};

config.dockerOpts = {
    socketPath: false,
    //host: 'http://docker-bridge',
    hostname: 'localhost',
    port: 6969
}
config.dockerOpts.host = 'http://'+config.dockerOpts.hostname;

config.runners = [
    {
        language: 'javascript',
        image: 'noderunner',
        cmd: ['/usr/local/bin/run'],
        extension: 'js'
    },
    {
        language: 'coffeescript',
        image: 'noderunner',
        cmd: ['/usr/local/bin/run'],
        extension: 'coffee'
    },
    {
        language: 'python',
        image: 'pyrunner',
        cmd: ['/usr/local/bin/run', '/opt/ve/pyrunner/bin/python', '/opt/apps/pyrunner/run.py'],
        extension: 'py'
    }];

module.exports = config;
