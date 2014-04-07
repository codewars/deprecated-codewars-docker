var config = {
    // [baseDir:] /some/path/to/base/ (ending-slash)
    port: 2222,
    repo: 'codewars'
};

var MEM_BASE = 128000;

config.dockerOpts = {
    socketPath: false,
    hostname: '172.17.42.1',
    version: 'v1.10',
    port: 6969
}
config.dockerOpts.host = 'http://'+config.dockerOpts.hostname;

config.runners = [
    {
        language: 'javascript',
        image: 'noderunner',
        cmd: ['/usr/local/bin/run'],
        extension: 'js',
        memory: MEM_BASE,
        pool: true
    },
    {
        language: 'coffeescript',
        image: 'noderunner',
        cmd: ['/usr/local/bin/run'],
        extension: 'coffee',
        memory: MEM_BASE,
        pool: false
    },
    {
        language: 'python',
        image: 'pyrunner',
        cmd: ['/usr/local/bin/run', '/opt/ve/pyrunner/bin/python', '/opt/apps/pyrunner/run.py'],
        extension: 'py',
        memory: MEM_BASE,
        pool: false 
    }];

module.exports = config;
