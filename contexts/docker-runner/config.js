var config = {
    // [baseDir:] /some/path/to/base/ (ending-slash)
    port: 2222,
    repo: 'codewars'
};

config.dockerOpts = {
    socketPath: false,
    //host: 'http://docker-bridge',
    //hostname: 'docker-bridge',
    hostname: '172.17.42.1',
    version: 'v1.8',
    port: 6969
}
config.dockerOpts.host = 'http://'+config.dockerOpts.hostname;

config.runners = [
    {
        language: 'javascript',
        image: 'noderunner',
        cmd: ['/usr/local/bin/run'],
        extension: 'js',
        pool: true
    },
    {
        language: 'coffeescript',
        image: 'noderunner',
        cmd: ['/usr/local/bin/run'],
        extension: 'coffee',
        pool: false
    },
    {
        language: 'python',
        image: 'pyrunner',
        cmd: ['/usr/local/bin/run', '/opt/ve/pyrunner/bin/python', '/opt/apps/pyrunner/run.py'],
        extension: 'py',
        pool: false
    }];

module.exports = config;
